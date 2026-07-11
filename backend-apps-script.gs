/**
 * Backend do Simulador de Consórcio — Liga Vitória
 * Google Apps Script (gratuito), publicado como Web App. A URL /exec fica em BACKEND_URL do widget.
 *
 * Grava os leads na planilha "Leads do Consórcio - Landbot", aba "Leads". Layout REAL das colunas
 * (o que este código escreve — ver a constante COL):
 *   1 created | 2 nome | 3 email | 4 telefone | 5 verificado | 6 tipo | 7 valor |
 *   8 plano | 9 credito | 10 parcela | 11 status | 12 uuid | 13 proposta (JSON, dados sensíveis)
 *
 * (Futuro: leads irão para o Salesforce; quando a integração do CRM estiver pronta, trocar o corpo
 *  de verifyOtp/updateLead por uma chamada à API deles.)
 *
 * SMS: API da Comtele (developers.comtele.com.br). Segredos ficam em Propriedades do Script — nunca aqui.
 *
 * REDEPLOY: NÃO use "Nova implantação" (gera outra URL /exec e quebra o BACKEND_URL do widget).
 *   Sincronize este arquivo em scratch/gas/Código.js e rode, a partir de scratch/gas/:
 *     clasp push  &&  clasp update-deployment <ID_DA_IMPLANTAÇÃO>   (edita a implantação existente)
 *   backend-apps-script.gs é a ÚNICA fonte da verdade.
 */

const SPREADSHEET_ID = '1FeMY6hfwSix7YR_ndVVxFjcqt2D4JaPWtd38Qc4wP3k';
const AIRTABLE_BASE = 'appAXa666ayzjld9S';

// Índices de coluna (1-based) da aba "Leads" — fonte única para leitura/escrita.
const COL = {
  CREATED: 1, NOME: 2, EMAIL: 3, TELEFONE: 4, VERIFICADO: 5, TIPO: 6,
  VALOR: 7, PLANO: 8, CREDITO: 9, PARCELA: 10, STATUS: 11, UUID: 12, PROPOSTA: 13
};

// Parâmetros de OTP e anti-abuso.
const OTP_MIN = 1500, OTP_RANGE = 8000;   // faixa 1500–9499 (paridade com o Landbot)
const OTP_TTL = 300;                      // código válido por 5 min
const MAX_ENVIOS = 3, ENVIOS_TTL = 600;   // máx. 3 ENVIOS por número a cada 10 min
const MAX_TENTATIVAS = 5;                 // máx. 5 tentativas de VERIFICAÇÃO por código (anti-brute-force)
const PLANS_TTL = 300;                    // cache de planos por (tabela,valor) — reduz martelamento do Airtable

// ---------- Segredos: Propriedades do Script (nunca no código-fonte) ----------
// Apps Script → ⚙ Configurações do projeto → Propriedades do script:
//   SMS_API_KEY    → x-api-key da Comtele (portal developers.comtele.com.br → "Sua Chave de API")
//   SMS_ROUTE      → rota de envio da Comtele (opcional; padrão "17")
//   AIRTABLE_TOKEN → Personal Access Token do Airtable (escopo data.records:read)
// Enquanto SMS_API_KEY estiver vazia, o backend roda em MODO TESTE (devolve o código na resposta, sem custo).
function prop(nome, padrao) {
  const v = PropertiesService.getScriptProperties().getProperty(nome);
  return (v === null || v === '') ? (padrao === undefined ? '' : padrao) : v;
}

// ---------- Utilidades de segurança/validação ----------
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Telefone válido = 10–11 dígitos (DDD + número), já sem country code. Retorna '' se inválido.
function telefoneValido(v) {
  const tel = String(v == null ? '' : v).replace(/\D/g, '');
  return /^\d{10,11}$/.test(tel) ? tel : '';
}

// Neutraliza injeção de fórmula/CSV na planilha: prefixa apóstrofo se o texto começa com =,+,-,@,TAB,CR.
function sane(v) {
  const s = (v == null) ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
function numOuSane(v) { return (typeof v === 'number') ? v : sane(v); }

// Código OTP com entropia melhor que Math.random(): derivado de um UUID v4, na mesma faixa do Landbot.
function codigoOtp() {
  const hex = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  return String(OTP_MIN + (parseInt(hex, 16) % OTP_RANGE));
}

// Envia o SMS pela API da Comtele (POST https://api.comtele.com.br/messages/sms/send, header x-api-key,
// corpo {receivers, message, route}). Valida hasError; em falha, lança erro (o roteador mascara p/ o cliente
// e o detalhe vai só para o Logger).
function enviarSMS(telefone, texto) {
  const apiKey = prop('SMS_API_KEY');
  if (!apiKey) throw new Error('SMS_API_KEY não configurada nas Propriedades do Script.');
  let n = String(telefone).replace(/\D/g, '');
  if (n.length <= 11) n = '55' + n; // widget envia DDD+número; prefixa o país sem duplicar o 55
  const resp = UrlFetchApp.fetch('https://api.comtele.com.br/messages/sms/send', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey },
    payload: JSON.stringify({ receivers: [n], message: texto, route: prop('SMS_ROUTE', '17'), tag: 'OTP-Liga' }),
    muteHttpExceptions: true
  });
  const httpCode = resp.getResponseCode();
  let corpo = {};
  try { corpo = JSON.parse(resp.getContentText()); } catch (e) { /* resposta não-JSON */ }
  if (httpCode !== 200 || corpo.hasError !== false) {
    throw new Error('Comtele recusou o envio (HTTP ' + httpCode + '): ' + (corpo.message || resp.getContentText()));
  }
}

// ---------- Roteador ----------
// Health-check: abrir a URL /exec no navegador deve mostrar esta mensagem.
function doGet() {
  return ContentService.createTextOutput('Backend do Simulador de Consórcio ativo ✓')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  const acoes = { send_otp: sendOtp, verify_otp: verifyOtp, get_plans: getPlans, update_lead: updateLead };
  try {
    if (!e || !e.postData || !e.postData.contents) return json({ ok: false, erro: 'Requisição inválida.' });
    const req = JSON.parse(e.postData.contents);
    const fn = acoes[req && req.action];
    if (typeof fn !== 'function') return json({ ok: false, erro: 'Requisição inválida.' });
    return json(fn(req));
  } catch (err) {
    // Nunca devolver o erro interno ao cliente — detalhe só no log do servidor.
    Logger.log('doPost erro: ' + (err && err.stack ? err.stack : err));
    return json({ ok: false, erro: 'Não foi possível processar agora. Tente novamente.' });
  }
}

// ---------- OTP ----------
function sendOtp(req) {
  const tel = telefoneValido(req && req.telefone);
  if (!tel) return { ok: false, erro: 'Telefone inválido.' };
  const cache = CacheService.getScriptCache();
  const enviados = Number(cache.get('cnt_' + tel) || 0);
  if (enviados >= MAX_ENVIOS) return { ok: false, erro: 'Limite de envios atingido. Aguarde alguns minutos.' };
  const codigo = codigoOtp();
  cache.put('otp_' + tel, codigo, OTP_TTL);
  cache.put('cnt_' + tel, String(enviados + 1), ENVIOS_TTL);
  cache.remove('try_' + tel); // novo código zera o contador de tentativas de verificação
  if (!prop('SMS_API_KEY')) {
    // MODO TESTE (SMS_API_KEY vazia): devolve o código na resposta; o widget o exibe como "SMS simulado".
    return { ok: true, demo_codigo: codigo };
  }
  enviarSMS(tel, 'Liga Vitoria Consorcio: seu codigo de verificacao e ' + codigo + '. Valido por 5 min. Nao compartilhe.');
  return { ok: true };
}

function verifyOtp(req) {
  const tel = telefoneValido(req && req.telefone);
  if (!tel) return { ok: false };
  const codigo = String((req && req.codigo) || '').replace(/\D/g, '');
  const cache = CacheService.getScriptCache();
  // Anti-brute-force: limita as TENTATIVAS de verificação por código (o limite de envio é separado).
  const tentativas = Number(cache.get('try_' + tel) || 0);
  if (tentativas >= MAX_TENTATIVAS) {
    cache.remove('otp_' + tel); // invalida o código: obriga a solicitar um novo
    return { ok: false, erro: 'Muitas tentativas. Solicite um novo codigo.' };
  }
  if (!codigo || cache.get('otp_' + tel) !== codigo) {
    cache.put('try_' + tel, String(tentativas + 1), OTP_TTL);
    return { ok: false };
  }
  cache.remove('otp_' + tel);
  cache.remove('try_' + tel);
  // Número verificado → grava o lead (nome + telefone verificado). Campos de texto passam por sane().
  const uuid = Utilities.getUuid();
  abaLeads().appendRow([new Date(), sane(req.nome), sane(req.email), tel, 'sim', sane(req.tipo),
                        '', '', '', '', 'lead verificado', uuid]);
  return { ok: true, uuid: uuid };
}

// ---------- Planos (Airtable "Tabela de Preços") ----------
function getPlans(req) {
  const valor = Number(req && req.valor);
  if (!(valor > 0)) return { ok: false, erro: 'Valor inválido.' };
  const tipoRaw = String((req && req.tipo) || '').toLowerCase();
  const tabela = (tipoRaw === 'auto' || tipoRaw === 'automóvel') ? 'Auto' : 'Imovel';
  const cache = CacheService.getScriptCache();
  const chaveCache = 'plans_' + tabela + '_' + Math.round(valor);
  const emCache = cache.get(chaveCache);
  if (emCache) return { ok: true, planos: JSON.parse(emCache) };
  // valor é Number (validado) → sem risco de injeção na fórmula. Mesma faixa ±10% (fallback ±20%) do Landbot.
  const filtro = function (faixa) {
    return 'AND((' + valor + '*' + (1 + faixa) + ')>{Credito},(' + valor + '*' + (1 - faixa) + ')<{Credito})';
  };
  const consulta = function (faixa) {
    const url = 'https://api.airtable.com/v0/' + AIRTABLE_BASE + '/' + encodeURIComponent(tabela) +
      '?filterByFormula=' + encodeURIComponent(filtro(faixa)) +
      '&sort%5B0%5D%5Bfield%5D=Credito&sort%5B0%5D%5Bdirection%5D=asc&maxRecords=12';
    const resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + prop('AIRTABLE_TOKEN') } });
    return JSON.parse(resp.getContentText()).records.map(function (r) { return r.fields; });
  };
  let planos = consulta(0.10);
  if (!planos.length) planos = consulta(0.20);
  cache.put(chaveCache, JSON.stringify(planos), PLANS_TTL);
  return { ok: true, planos: planos };
}

// Alternativa NÃO USADA (não é chamada pelo roteador): ler os planos da aba "Planos" da própria planilha,
// caso um dia se queira dispensar o Airtable. Mantida como referência para o time comercial.
function getPlansDaPlanilha(req) {
  const valor = Number(req.valor);
  const linhas = planilha().getSheetByName('Planos').getDataRange().getValues();
  const cab = linhas.shift();
  const todos = linhas.map(function (l) { const o = {}; cab.forEach(function (c, i) { o[c] = l[i]; }); return o; });
  const busca = function (faixa) {
    return todos.filter(function (p) {
      return String(p.tipo).toLowerCase() === String(req.tipo).toLowerCase() &&
             p.credito > valor * (1 - faixa) && p.credito < valor * (1 + faixa);
    });
  };
  let planos = busca(0.10);
  if (!planos.length) planos = busca(0.20);
  planos.sort(function (a, b) { return a.credito - b.credito; });
  return { ok: true, planos: planos.slice(0, 12) };
}

// ---------- Atualização do lead (valor, plano escolhido, proposta) ----------
function updateLead(req) {
  const uuid = String((req && req.uuid) || '');
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return { ok: false, erro: 'lead não encontrado' };
  const aba = abaLeads();
  const dados = aba.getDataRange().getValues();
  for (let i = dados.length - 1; i >= 1; i--) {
    if (dados[i][COL.UUID - 1] === uuid) {
      const linha = i + 1;
      if (req.valor != null) aba.getRange(linha, COL.VALOR).setValue(numOuSane(req.valor));
      if (req.plano) aba.getRange(linha, COL.PLANO, 1, 3).setValues([[sane(req.plano), numOuSane(req.credito), numOuSane(req.parcela)]]);
      if (req.status) aba.getRange(linha, COL.STATUS).setValue(sane(req.status));
      // Proposta com dados sensíveis (CPF, RG, endereço) — LGPD: restrinja o compartilhamento da
      // planilha, defina prazo de retenção e mantenha o texto de consentimento no widget.
      if (req.proposta) aba.getRange(linha, COL.PROPOSTA).setValue(JSON.stringify(req.proposta));
      return { ok: true };
    }
  }
  return { ok: false, erro: 'lead não encontrado' };
}

// ---------- Utilidades ----------
function planilha() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function abaLeads() { return planilha().getSheetByName('Leads'); }
