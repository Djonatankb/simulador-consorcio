/**
 * Backend do Simulador de Consórcio — Liga Vitória
 * Google Apps Script (gratuito), publicado como Web App. A URL /exec fica em BACKEND_URL do widget.
 *
 * Grava os leads na planilha "Leads do Consórcio - Landbot", aba "Leads" — a original do Landbot,
 * com colunas nomeadas na linha 1. A escrita é POR NOME DE CABEÇALHO (nunca por posição): ver
 * a constante MAPA_COLUNAS (campo interno → cabeçalho) e os helpers indiceColunas/gravaCampos.
 * Isso deixa o código imune a reordenação de colunas na planilha. Duas colunas próprias do widget
 * (uuid_widget, status_widget, kommo_lead_id) são criadas automaticamente no fim da planilha por garanteColunasWidget.
 *
 * INTEGRAÇÃO CRM KOMMO (DIRETA E SEM N8N):
 *   As chamadas de criação (complex) e atualização (patch) do Kommo CRM acontecem diretamente
 *   neste backend via UrlFetchApp, salvando o ID do lead na planilha em tempo real.
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

// Configurações do Kommo CRM (Podem ser sobrescritas via Propriedades do Script KOMMO_TOKEN, KOMMO_SUBDOMAIN, etc.)
const KOMMO_SUBDOMAIN_DEFAULT = 'gustavoligavitoriacom';
const KOMMO_STAGE_TRANSMISSAO_DEFAULT = 109093615;
const KOMMO_PIPELINE_ID_DEFAULT = 14131759;

// DE-PARA campo interno → cabeçalho da aba "Leads" (linha 1). Escrita é POR NOME — imune a
// reordenação de colunas.
const MAPA_COLUNAS = {
  data:'Data', nome:'Nome', email:'Email', cpf:'CPF', telefone:'Telefone',
  tipo:'Tipo de Consórcio', valor:'Valor desejado', plano:'Código Consórcio',
  descricao:'Descrição Consórcio', credito:'Valor Consórcio', parcela:'Parcela Consórcio',
  pontos:'Pontos Livelo', dispositivo:'Dispositivo', url:'URL',
  nome_completo:'nome_completo', nascimento:'data_de_nascimento', rg:'rg_doc',
  orgao:'orgao_emissor', naturalidade:'naturalidade', nome_mae:'nome_completo_da_mae',
  endereco:'endereco_completo', cep:'cep',
  uuid:'uuid_widget', status:'status_widget', kommo_lead_id:'kommo_lead_id'
};

// Parâmetros de OTP e anti-abuso.
const OTP_MIN = 1500, OTP_RANGE = 8000;   // faixa 1500–9499 (paridade com o Landbot)
const OTP_TTL = 300;                      // código válido por 5 min
const MAX_ENVIOS = 3, ENVIOS_TTL = 600;   // máx. 3 ENVIOS por número a cada 10 min
const MAX_TENTATIVAS = 5;                 // máx. 5 tentativas de VERIFICAÇÃO por código (anti-brute-force)
const PLANS_TTL = 300;                    // cache de planos por (tabela,valor) — reduz martelamento do Airtable

// ---------- Integração Direta Kommo CRM API v4 ----------
function conectarKommo(endpoint, method, payload) {
  const token = prop('KOMMO_TOKEN');
  if (!token) {
    Logger.log('conectarKommo ignorado: KOMMO_TOKEN não configurado em Propriedades do Script.');
    return null;
  }
  const subdominio = prop('KOMMO_SUBDOMAIN', KOMMO_SUBDOMAIN_DEFAULT);
  const url = 'https://' + subdominio + '.kommo.com/api/v4/' + endpoint.replace(/^\//, '');
  const opcoes = {
    method: method.toLowerCase(),
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  };
  if (payload) opcoes.payload = JSON.stringify(payload);

  try {
    const resp = UrlFetchApp.fetch(url, opcoes);
    const code = resp.getResponseCode();
    let jsonResp = {};
    try { jsonResp = JSON.parse(resp.getContentText()); } catch (e) {}
    if (code >= 200 && code < 300) {
      return jsonResp;
    } else {
      Logger.log('Kommo API Erro (HTTP ' + code + '): ' + resp.getContentText());
      return null;
    }
  } catch (err) {
    Logger.log('conectarKommo exceção: ' + (err && err.stack ? err.stack : err));
    return null;
  }
}

// Cria lead inicial na etapa de Triagem do Kommo CRM
function criarLeadKommo(nome, email, telefone, tipo) {
  const payload = [
    {
      name: 'Consórcio ' + (tipo || 'Imóvel') + ' - ' + (nome || 'Lead'),
      _embedded: {
        tags: [ { name: 'Simulador Consórcio' } ],
        contacts: [
          {
            first_name: nome || 'Cliente',
            custom_fields_values: [
              {
                field_code: 'PHONE',
                values: [ { value: telefone } ]
              },
              {
                field_code: 'EMAIL',
                values: [ { value: email } ]
              }
            ]
          }
        ]
      }
    }
  ];
  const resp = conectarKommo('leads/complex', 'post', payload);
  if (resp && resp[0] && resp[0].id) {
    return resp[0].id;
  }
  return null;
}

// Atualiza o lead no Kommo CRM (move para Transmissão e atualiza o valor do consórcio)
function atualizarLeadKommo(leadId, valor, tipo, nomeCompleto) {
  const stageId = Number(prop('KOMMO_STAGE_TRANSMISSAO', KOMMO_STAGE_TRANSMISSAO_DEFAULT));
  const pipelineId = Number(prop('KOMMO_PIPELINE_ID', KOMMO_PIPELINE_ID_DEFAULT));

  const payload = [
    {
      id: Number(leadId),
      price: Number(valor || 0),
      pipeline_id: pipelineId,
      status_id: stageId
    }
  ];
  if (nomeCompleto || tipo) {
    payload[0].name = '🔥 PROPOSTA ' + (tipo || 'Imóvel') + ' - ' + (nomeCompleto || 'Cliente');
  }
  return conectarKommo('leads', 'patch', payload);
}

// ---------- Segredos: Propriedades do Script (nunca no código-fonte) ----------
function prop(nome, padrao) {
  const v = PropertiesService.getScriptProperties().getProperty(nome);
  return (v === null || v === '') ? (padrao === undefined ? '' : padrao) : v;
}

// ---------- Utilidades de segurança/validação ----------
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function telefoneValido(v) {
  const tel = String(v == null ? '' : v).replace(/\D/g, '');
  return /^\d{10,11}$/.test(tel) ? tel : '';
}

function sane(v) {
  const s = (v == null) ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
function numOuSane(v) { return (typeof v === 'number') ? v : sane(v); }

function codigoOtp() {
  const hex = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  return String(OTP_MIN + (parseInt(hex, 16) % OTP_RANGE));
}

function enviarSMS(telefone, texto) {
  const apiKey = prop('SMS_API_KEY');
  if (!apiKey) throw new Error('SMS_API_KEY não configurada nas Propriedades do Script.');
  let n = String(telefone).replace(/\D/g, '');
  if (n.length <= 11) n = '55' + n;
  const resp = UrlFetchApp.fetch('https://api.comtele.com.br/messages/sms/send', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey },
    payload: JSON.stringify({ receivers: [n], message: texto, route: prop('SMS_ROUTE', '17'), tag: 'OTP-Liga' }),
    muteHttpExceptions: true
  });
  const httpCode = resp.getResponseCode();
  let corpo = {};
  try { corpo = JSON.parse(resp.getContentText()); } catch (e) { }
  if (httpCode !== 200 || corpo.hasError !== false) {
    throw new Error('Comtele recusou o envio (HTTP ' + httpCode + '): ' + (corpo.message || resp.getContentText()));
  }
}

// ---------- Roteador ----------
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
    Logger.log('doPost erro: ' + (err && err.stack ? err.stack : err));
    return json({ ok: false, erro: 'Não foi possível processar agora. Tente novamente.' });
  }
}

// ---------- OTP & Gravação Inicial ----------
function sendOtp(req) {
  const tel = telefoneValido(req && req.telefone);
  if (!tel) return { ok: false, erro: 'Telefone inválido.' };
  const cache = CacheService.getScriptCache();
  const enviados = Number(cache.get('cnt_' + tel) || 0);
  if (enviados >= MAX_ENVIOS) return { ok: false, erro: 'Limite de envios atingido. Aguarde alguns minutos.' };
  const codigo = codigoOtp();
  cache.put('otp_' + tel, codigo, OTP_TTL);
  cache.put('cnt_' + tel, String(enviados + 1), ENVIOS_TTL);
  cache.remove('try_' + tel);
  if (!prop('SMS_API_KEY')) {
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
  const tentativas = Number(cache.get('try_' + tel) || 0);
  if (tentativas >= MAX_TENTATIVAS) {
    cache.remove('otp_' + tel);
    return { ok: false, erro: 'Muitas tentativas. Solicite um novo codigo.' };
  }
  if (!codigo || cache.get('otp_' + tel) !== codigo) {
    cache.put('try_' + tel, String(tentativas + 1), OTP_TTL);
    return { ok: false };
  }

  const uuid = Utilities.getUuid();
  let kommoLeadId = null;

  // 1. Criar Lead no Kommo CRM diretamente
  try {
    kommoLeadId = criarLeadKommo(req.nome, req.email, tel, req.tipo);
  } catch (errKommo) {
    Logger.log('Erro ao criar lead no Kommo: ' + errKommo);
  }

  // 2. Gravar Lead na Planilha Google Sheets
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const aba = abaLeads();
    garanteColunasWidget(aba);
    const linha = aba.getLastRow() + 1;
    gravaCampos(aba, linha, { data: new Date(), nome: sane(req.nome), email: sane(req.email),
      telefone: tel, tipo: sane(req.tipo), dispositivo: sane(req.dispositivo), url: sane(req.url),
      uuid: uuid, status: 'lead verificado', kommo_lead_id: kommoLeadId });
  } finally { lock.releaseLock(); }

  cache.remove('otp_' + tel);
  cache.remove('try_' + tel);
  return { ok: true, uuid: uuid };
}

// ---------- Planos (Airtable) ----------
function getPlans(req) {
  const valor = Number(req && req.valor);
  if (!(valor > 0)) return { ok: false, erro: 'Valor inválido.' };
  const tipoRaw = String((req && req.tipo) || '').toLowerCase();
  const tabela = (tipoRaw === 'auto' || tipoRaw === 'automóvel') ? 'Auto' : 'Imovel';
  const cache = CacheService.getScriptCache();
  const chaveCache = 'plans_' + tabela + '_' + Math.round(valor);
  const emCache = cache.get(chaveCache);
  if (emCache) return { ok: true, planos: JSON.parse(emCache) };

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

// ---------- Atualização do lead (proposta completa) ----------
function updateLead(req) {
  const uuid = String((req && req.uuid) || '');
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) return { ok: false, erro: 'lead não encontrado' };
  const aba = abaLeads();
  const indice = indiceColunas(aba);
  if (!indice.uuid) return { ok: false, erro: 'lead não encontrado' };
  const dados = aba.getDataRange().getValues();
  const colUuid = indice.uuid - 1;
  const colKommoId = indice.kommo_lead_id ? indice.kommo_lead_id - 1 : -1;

  for (let i = dados.length - 1; i >= 1; i--) {
    if (dados[i][colUuid] !== uuid) continue;
    const linha = i + 1;
    const campos = {
      valor: numOuSane(req.valor), plano: sane(req.plano), descricao: sane(req.descricao),
      credito: numOuSane(req.credito), parcela: numOuSane(req.parcela), pontos: numOuSane(req.pontos),
      status: sane(req.status)
    };

    let kommoLeadId = colKommoId >= 0 ? dados[i][colKommoId] : null;

    if (req.proposta) {
      ['nome_completo', 'cpf', 'nascimento', 'rg', 'orgao', 'naturalidade', 'nome_mae', 'endereco', 'cep']
        .forEach(function (campo) { campos[campo] = sane(req.proposta[campo]); });

      // Atualiza no Kommo CRM se o ID estiver salvo
      if (kommoLeadId) {
        try {
          atualizarLeadKommo(kommoLeadId, req.valor, req.tipo || (indice.tipo ? dados[i][indice.tipo - 1] : ''), req.proposta.nome_completo);
        } catch (errKommo) {
          Logger.log('Erro ao atualizar lead no Kommo: ' + errKommo);
        }
      }
    }
    gravaCampos(aba, linha, campos);
    return { ok: true };
  }
  return { ok: false, erro: 'lead não encontrado' };
}

// ---------- Função de Teste Manual (Roda com 1 Clique no Apps Script) ----------
function testarIntegracaoKommo() {
  Logger.log('--- 1. Criando Lead de Teste no Kommo ---');
  const leadId = criarLeadKommo('Teste Manual Apps Script', 'teste.manual@ligavitoria.com.br', '27999880011', 'Imóvel');
  Logger.log('ID do Lead criado no Kommo: ' + leadId);

  if (leadId) {
    Logger.log('--- 2. Atualizando Lead para Transmissão ---');
    const respPatch = atualizarLeadKommo(leadId, 1500000, 'Imóvel', 'Teste Manual Apps Script Completo');
    Logger.log('Resposta do Patch no Kommo: ' + JSON.stringify(respPatch));
  } else {
    Logger.log('Atenção: Configure a propriedade KOMMO_TOKEN em Propriedades do Script para testar.');
  }
}

// ---------- Utilidades ----------
function planilha() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function abaLeads() { return planilha().getSheetByName('Leads'); }

function garanteColunasWidget(aba) {
  const ultimaCol = aba.getLastColumn();
  const cabecalhos = aba.getRange(1, 1, 1, ultimaCol).getValues()[0];
  const faltando = ['uuid_widget', 'status_widget', 'kommo_lead_id'].filter(function (nome) {
    return cabecalhos.indexOf(nome) === -1;
  });
  faltando.forEach(function (nome, i) { aba.getRange(1, ultimaCol + 1 + i).setValue(nome); });
}

function indiceColunas(aba) {
  const ultimaCol = aba.getLastColumn();
  const cabecalhos = aba.getRange(1, 1, 1, ultimaCol).getValues()[0];
  const indice = {};
  Object.keys(MAPA_COLUNAS).forEach(function (campo) {
    const col = cabecalhos.indexOf(MAPA_COLUNAS[campo]) + 1;
    if (col > 0) indice[campo] = col;
  });
  return indice;
}

function gravaCampos(aba, linha, campos) {
  const indice = indiceColunas(aba);
  Object.keys(campos).forEach(function (campo) {
    const valor = campos[campo];
    if (valor === undefined || valor === '') return;
    const col = indice[campo];
    if (col) aba.getRange(linha, col).setValue(valor);
  });
}
