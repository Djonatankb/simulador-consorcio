/**
 * Backend do Simulador de Consórcio — Liga Vitória
 * Google Apps Script (gratuito), publicado como Web App. A URL /exec fica em BACKEND_URL do widget.
 *
 * Grava os leads na planilha "Leads do Consórcio - Landbot", aba "Leads" — a original do Landbot,
 * com 33 colunas nomeadas na linha 1. A escrita é POR NOME DE CABEÇALHO (nunca por posição): ver
 * a constante MAPA_COLUNAS (campo interno → cabeçalho) e os helpers indiceColunas/gravaCampos.
 * Isso deixa o código imune a reordenação de colunas na planilha. Duas colunas próprias do widget
 * (uuid_widget, status_widget) são criadas automaticamente no fim da planilha por garanteColunasWidget.
 *
 * (Futuro: leads irão para o Salesforce; quando a integração do CRM estiver pronta, MAPA_COLUNAS é
 *  o DE-PARA a portar — trocar o corpo de verifyOtp/updateLead por uma chamada à API deles.)
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

// DE-PARA campo interno → cabeçalho da aba "Leads" (linha 1). Escrita é POR NOME — imune a
// reordenação de colunas. (Salesforce futuro: este dicionário é o mapeamento a portar p/ o CRM.)
const MAPA_COLUNAS = {
  data:'Data', nome:'Nome', email:'Email', cpf:'CPF', telefone:'Telefone',
  tipo:'Tipo de Consórcio', valor:'Valor desejado', plano:'Código Consórcio',
  descricao:'Descrição Consórcio', credito:'Valor Consórcio', parcela:'Parcela Consórcio',
  pontos:'Pontos Livelo', dispositivo:'Dispositivo', url:'URL',
  nome_completo:'nome_completo', nascimento:'data_de_nascimento', rg:'rg_doc',
  orgao:'orgao_emissor', naturalidade:'naturalidade', nome_mae:'nome_completo_da_mae',
  endereco:'endereco_completo', cep:'cep',
  uuid:'uuid_widget', status:'status_widget'   // colunas do widget, criadas no fim da planilha
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
  // Número verificado → grava o lead (nome + telefone verificado). Campos de texto passam por sane().
  // Trava a linha contra corrida de dois leads simultâneos (dois getLastRow() lendo a mesma linha).
  const uuid = Utilities.getUuid();
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const aba = abaLeads();
    garanteColunasWidget(aba);
    const linha = aba.getLastRow() + 1;
    gravaCampos(aba, linha, { data: new Date(), nome: sane(req.nome), email: sane(req.email),
      telefone: tel, tipo: sane(req.tipo), dispositivo: sane(req.dispositivo), url: sane(req.url),
      uuid: uuid, status: 'lead verificado' });
  } finally { lock.releaseLock(); }
  // OTP só é invalidado APÓS a gravação: se o Sheets/lock falhar, o código segue válido (TTL 5min)
  // e o usuário repete a verificação sem precisar de novo SMS.
  cache.remove('otp_' + tel);
  cache.remove('try_' + tel);
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
  const indice = indiceColunas(aba);
  if (!indice.uuid) return { ok: false, erro: 'lead não encontrado' };
  const dados = aba.getDataRange().getValues();
  const colUuid = indice.uuid - 1;
  for (let i = dados.length - 1; i >= 1; i--) {
    if (dados[i][colUuid] !== uuid) continue;
    const linha = i + 1;
    const campos = {
      valor: numOuSane(req.valor), plano: sane(req.plano), descricao: sane(req.descricao),
      credito: numOuSane(req.credito), parcela: numOuSane(req.parcela), pontos: numOuSane(req.pontos),
      status: sane(req.status)
    };
    // Proposta com dados sensíveis (CPF, RG, endereço) — agora em colunas nomeadas, não mais um JSON
    // numa célula só. LGPD: mesma cautela de sempre — restrinja compartilhamento e defina retenção.
    if (req.proposta) {
      ['nome_completo', 'cpf', 'nascimento', 'rg', 'orgao', 'naturalidade', 'nome_mae', 'endereco', 'cep']
        .forEach(function (campo) { campos[campo] = sane(req.proposta[campo]); });
    }
    gravaCampos(aba, linha, campos);
    return { ok: true };
  }
  return { ok: false, erro: 'lead não encontrado' };
}

// ---------- Migração one-off ----------
// Corrige as linhas gravadas com o layout antigo (por posição, 13 colunas) para o mapeamento por
// nome de cabeçalho (MAPA_COLUNAS). RODAR UMA VEZ MANUALMENTE no editor do Apps Script (selecionar
// esta função na barra de execução → Executar) e depois pode remover. Não é chamada pelo roteador.
function migrarLinhasDescasadas() {
  const LINHA_INICIO = 10605, LINHA_FIM = 10610; // faixa das linhas descasadas nesta planilha
  const aba = abaLeads();
  garanteColunasWidget(aba);
  for (let linha = LINHA_INICIO; linha <= LINHA_FIM; linha++) {
    // Layout antigo: created, nome, email, telefone, verificado, tipo, valor, plano, credito,
    // parcela, status, uuid, proposta (JSON).
    const antigas = aba.getRange(linha, 1, 1, 13).getValues()[0];
    const created = antigas[0], nome = antigas[1], email = antigas[2], telefone = antigas[3],
          tipo = antigas[5], valor = antigas[6], plano = antigas[7], credito = antigas[8],
          parcela = antigas[9], status = antigas[10], uuid = antigas[11], propostaRaw = antigas[12];
    aba.getRange(linha, 1, 1, 13).clearContent();
    const campos = {
      data: created, nome: sane(nome), email: sane(email), telefone: sane(telefone), tipo: sane(tipo),
      valor: numOuSane(valor), plano: sane(plano), credito: numOuSane(credito), parcela: numOuSane(parcela),
      status: sane(status), uuid: sane(uuid)
    };
    if (propostaRaw) {
      try {
        const proposta = JSON.parse(propostaRaw);
        ['nome_completo', 'cpf', 'nascimento', 'rg', 'orgao', 'naturalidade', 'nome_mae', 'endereco', 'cep']
          .forEach(function (campo) { campos[campo] = sane(proposta[campo]); });
      } catch (e) { /* célula 13 não era JSON válido — ignora, migra só o que dá */ }
    }
    gravaCampos(aba, linha, campos);
  }
}

// ---------- Utilidades ----------
function planilha() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function abaLeads() { return planilha().getSheetByName('Leads'); }

// Garante que a aba tenha as colunas do widget (uuid_widget/status_widget); cria as que faltarem
// logo após o último cabeçalho existente, sem mexer no layout original do Landbot.
function garanteColunasWidget(aba) {
  const ultimaCol = aba.getLastColumn();
  const cabecalhos = aba.getRange(1, 1, 1, ultimaCol).getValues()[0];
  const faltando = ['uuid_widget', 'status_widget'].filter(function (nome) {
    return cabecalhos.indexOf(nome) === -1;
  });
  faltando.forEach(function (nome, i) { aba.getRange(1, ultimaCol + 1 + i).setValue(nome); });
}

// Lê a linha 1 e devolve {campoInterno: coluna(1-based)} para cada entrada de MAPA_COLUNAS
// encontrada no cabeçalho (ignora as ausentes).
function indiceColunas(aba) {
  const ultimaCol = aba.getLastColumn();
  const cabecalhos = aba.getRange(1, 1, 1, ultimaCol).getValues()[0];
  const indice = {};
  Object.keys(MAPA_COLUNAS).forEach(function (campo) {
    const col = cabecalhos.indexOf(MAPA_COLUNAS[campo]) + 1; // indexOf -1 (ausente) vira col 0
    if (col > 0) indice[campo] = col;
  });
  // Cabeçalho renomeado/divergente = campo que deixaria de ser gravado em silêncio — deixa rastro no log.
  const ausentes = Object.keys(MAPA_COLUNAS).filter(function (campo) { return !indice[campo]; });
  if (ausentes.length) Logger.log('indiceColunas: sem coluna na planilha para: ' + ausentes.join(', '));
  return indice;
}

// Diagnóstico manual (rodar no editor do Apps Script após qualquer mudança na planilha):
// lista os campos de MAPA_COLUNAS sem coluna correspondente na linha 1. Vazio = DE-PARA íntegro.
function diagnosticoColunas() {
  const indice = indiceColunas(abaLeads());
  const ausentes = Object.keys(MAPA_COLUNAS).filter(function (c) { return !indice[c]; });
  Logger.log(ausentes.length ? 'AUSENTES: ' + ausentes.join(', ') : 'OK — todos os cabeçalhos casam.');
  return ausentes;
}

// Grava {campoInterno: valor} nas colunas correspondentes (por nome de cabeçalho), pulando
// valores undefined/''. Uma leitura de cabeçalho por chamada — aceitável no volume deste backend.
function gravaCampos(aba, linha, campos) {
  const indice = indiceColunas(aba);
  Object.keys(campos).forEach(function (campo) {
    const valor = campos[campo];
    if (valor === undefined || valor === '') return;
    const col = indice[campo];
    if (col) aba.getRange(linha, col).setValue(valor);
  });
}
