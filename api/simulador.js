/**
 * Vercel Serverless Function — Backend Simulador de Consórcio Liga Vitória
 * Rota: /api/simulador
 */

const crypto = require('crypto');
let google = null;
try {
  google = require('googleapis').google;
} catch (e) {
  // googleapis não instalado no ambiente local
}

// Cache em memória do Vercel Serverless Instance (para OTPs e Planos)
const memoryCache = new Map();

const kommo = require('../lib/kommo');

// Parâmetros OTP e Integrações
const OTP_MIN = 1500, OTP_RANGE = 8000;
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutos
const AIRTABLE_BASE_DEFAULT = 'appAXa666ayzjld9S';
const SPREADSHEET_ID_DEFAULT = '1FeMY6hfwSix7YR_ndVVxFjcqt2D4JaPWtd38Qc4wP3k';

function getEnv(key, defaultValue = '') {
  return process.env[key] || defaultValue;
}

// Telefone válido (10-11 dígitos)
function telefoneValido(v) {
  const tel = String(v || '').replace(/\D/g, '');
  return /^\d{10,11}$/.test(tel) ? tel : '';
}

// Código OTP com aleatoriedade segura
function codigoOtp() {
  const buf = crypto.randomBytes(4);
  const num = buf.readUInt32BE(0);
  return String(OTP_MIN + (num % OTP_RANGE));
}

// Envia SMS via Comtele
async function enviarSMS(telefone, texto) {
  const apiKey = getEnv('SMS_API_KEY');
  if (!apiKey) throw new Error('SMS_API_KEY não configurada.');

  let n = String(telefone).replace(/\D/g, '');
  if (n.length <= 11) n = '55' + n;

  const resp = await fetch('https://api.comtele.com.br/messages/sms/send', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      receivers: [n],
      message: texto,
      route: getEnv('SMS_ROUTE', '17'),
      tag: 'OTP-Liga'
    })
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.hasError !== false) {
    throw new Error('Falha no envio de SMS Comtele: ' + (data.message || resp.statusText));
  }
}

const MAPA_COLUNAS = {
  data: 'Data',
  nome: 'Nome',
  email: 'Email',
  cpf: 'CPF',
  telefone: 'Telefone',
  tipo: 'Tipo de Consórcio',
  valor: 'Valor desejado',
  plano: 'Código Consórcio',
  descricao: 'Descrição Consórcio',
  credito: 'Valor Consórcio',
  parcela: 'Parcela Consórcio',
  pontos: 'Pontos Livelo',
  dispositivo: 'Dispositivo',
  url: 'URL',
  nome_completo: 'nome_completo',
  nascimento: 'data_de_nascimento',
  rg: 'rg_doc',
  orgao: 'orgao_emissor',
  naturalidade: 'naturalidade',
  nome_mae: 'nome_completo_da_mae',
  endereco: 'endereco_completo',
  cep: 'cep',
  remuneracao_atual: 'remuneracao_atual',
  estado_civil: 'estado_civil',
  nome_completo_do_conjuge: 'nome_completo_do_conjuge',
  cpf_do_conjuge: 'cpf_do_conjuge',
  data_nascimento_conjuge: 'data_nascimento_conjuge',
  metodo_pagamento_1_parcela: 'metodo_pagamento_1_parcela',
  metodo_pagamento_demais_parcela: 'metodo_pagamento_demais_parcela',
  profissao: 'profissao',
  uuid: 'uuid_widget',
  status: 'status_widget'
};

// Gravação e Atualização Inteligente no Google Sheets (Alinhado com os Cabeçalhos da Planilha)
async function gravarGoogleSheets(camposLinha) {
  if (!google) {
    console.warn('googleapis não carregado no ambiente.');
    return;
  }

  const clientEmail = getEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  let privateKey = getEnv('GOOGLE_PRIVATE_KEY');

  if (!clientEmail || !privateKey) {
    console.log('GOOGLE_SERVICE_ACCOUNT_EMAIL ou GOOGLE_PRIVATE_KEY ausentes.');
    return;
  }

  privateKey = privateKey.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n').trim();

  try {
    const auth = new google.auth.JWT(
      clientEmail,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = getEnv('GOOGLE_SPREADSHEET_ID', SPREADSHEET_ID_DEFAULT);

    const targetUuid = String(camposLinha.uuid || '').trim();

    // 1. Busca a primeira linha (cabeçalho) para saber a ordem exata das colunas
    let headers = [];
    try {
      const headerResp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: '1:1'
      });
      headers = headerResp.data.values?.[0] || [];
    } catch (eH) {
      console.warn('Não foi possível ler os cabeçalhos do Google Sheets:', eH?.message);
    }

function formatarDataBR(d = new Date()) {
  const date = new Date(d);
  const dia = String(date.getDate()).padStart(2, '0');
  const mes = String(date.getMonth() + 1).padStart(2, '0');
  const ano = date.getFullYear();
  return `${dia}/${mes}/${ano}`;
}

    // Mapa de dados disponíveis para a linha
    const mapaValores = {
      'Data': formatarDataBR(),
      'Nome': camposLinha.nome || '',
      'Email': camposLinha.email || '',
      'CPF': camposLinha.cpf || '',
      'Telefone': camposLinha.telefone || '',
      'Tipo de Consórcio': camposLinha.tipo || '',
      'Valor desejado': camposLinha.valor || '',
      'Código Consórcio': camposLinha.plano || '',
      'Descrição Consórcio': camposLinha.descricao || '',
      'Valor Consórcio': camposLinha.credito || '',
      'Parcela Consórcio': camposLinha.parcela || '',
      'Pontos Livelo': camposLinha.pontos || '',
      'Dispositivo': camposLinha.dispositivo || '',
      'URL': camposLinha.url || '',
      'nome_completo': camposLinha.nome_completo || '',
      'data_de_nascimento': camposLinha.nascimento || '',
      'rg_doc': camposLinha.rg || '',
      'orgao_emissor': camposLinha.orgao || '',
      'naturalidade': camposLinha.naturalidade || '',
      'nome_completo_da_mae': camposLinha.nome_mae || '',
      'endereco_completo': camposLinha.endereco || '',
      'cep': camposLinha.cep || '',
      'remuneracao_atual': camposLinha.remuneracao_atual || '',
      'estado_civil': camposLinha.estado_civil || '',
      'nome_completo_do_conjuge': camposLinha.nome_completo_do_conjuge || '',
      'cpf_do_conjuge': camposLinha.cpf_do_conjuge || '',
      'data_nascimento_conjuge': camposLinha.data_nascimento_conjuge || '',
      'metodo_pagamento_1_parcela': camposLinha.metodo_pagamento_1_parcela || '',
      'metodo_pagamento_demais_parcela': camposLinha.metodo_pagamento_demais_parcela || '',
      'profissao': camposLinha.profissao || '',
      'uuid_widget': targetUuid,
      'status_widget': camposLinha.status || '',
      'kommo_lead_id': camposLinha.kommo_lead_id || ''
    };

    // Monta o array da linha respeitando a ordem dos cabeçalhos da planilha
    let rowValues = [];
    let uuidColIndex = 0; // Coluna A por padrão (índice 0)

    if (headers.length > 0) {
      rowValues = headers.map((colName, idx) => {
        const keyTrimmed = String(colName || '').trim();
        if (keyTrimmed === 'uuid_widget' || keyTrimmed === 'ID' || keyTrimmed === 'uuid') {
          uuidColIndex = idx;
        }
        return mapaValores[keyTrimmed] !== undefined ? mapaValores[keyTrimmed] : '';
      });
    } else {
      // Ordem padrão caso a planilha não tenha cabeçalho
      rowValues = Object.values(mapaValores);
    }

    // Helper para converter índice numérico de coluna para letra (ex: 0 -> A, 24 -> Y)
    const getColLetter = (index) => {
      let temp, letter = '';
      let i = index;
      while (i >= 0) {
        temp = i % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        i = Math.floor(i / 26) - 1;
      }
      return letter;
    };

    const uuidColLetter = getColLetter(uuidColIndex);

    // 2. Busca se a ID (targetUuid) já existe na coluna do UUID
    let rowIndex = -1;
    if (targetUuid) {
      try {
        const getResp = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${uuidColLetter}:${uuidColLetter}`
        });
        const rows = getResp.data.values || [];
        for (let i = 0; i < rows.length; i++) {
          if (rows[i] && String(rows[i][0]).trim() === targetUuid) {
            rowIndex = i + 1; // 1-indexed no Google Sheets
            break;
          }
        }
      } catch (errSearch) {
        console.warn('Busca de linha por ID falhou:', errSearch?.message);
      }
    }

    const lastColLetter = getColLetter(rowValues.length - 1);

    if (rowIndex > 0) {
      // 3. Se a linha existir, ATUALIZA a mesma linha na planilha!
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `A${rowIndex}:${lastColLetter}${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [rowValues] }
      });
      console.log(`✅ Linha ${rowIndex} atualizada no Google Sheets (ID: ${targetUuid})`);
    } else {
      // 4. Se a linha não existir, CRIA uma nova linha na planilha!
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `A:${lastColLetter}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [rowValues] }
      });
      console.log(`✅ Nova linha criada no Google Sheets (ID: ${targetUuid})`);
    }
  } catch (err) {
    console.error('Google Sheets Error:', err?.message || err);
    if (err?.response?.data) {
      console.error('Detalhes Google Sheets:', JSON.stringify(err.response.data));
    }
  }
}

// Map para controle de Rate Limit de envio de SMS por telefone (cooldown de 60s)
const smsCooldownMap = new Map();

// Handlers das Ações
async function handleSendOtp(body) {
  const tel = telefoneValido(body.telefone);
  if (!tel) return { ok: false, erro: 'Telefone inválido.' };

  const agora = Date.now();
  const ultimoEnvio = smsCooldownMap.get(tel) || 0;
  const SEGUNDOS_COOLDOWN = 60;

  if (agora - ultimoEnvio < SEGUNDOS_COOLDOWN * 1000) {
    const esperaResta = Math.ceil((SEGUNDOS_COOLDOWN * 1000 - (agora - ultimoEnvio)) / 1000);
    return { ok: false, erro: `Aguarde ${esperaResta}s para solicitar um novo código por SMS.` };
  }

  const skipSms = getEnv('SKIP_SMS_VERIFICATION', 'true') === 'true';
  const codigo = codigoOtp();
  memoryCache.set(`otp_${tel}`, { codigo, exp: Date.now() + OTP_TTL_MS });

  if (skipSms) {
    smsCooldownMap.set(tel, agora);
    return { ok: true, demo_codigo: `${codigo} (Qualquer código aceito)` };
  }

  const apiKey = getEnv('SMS_API_KEY');
  if (!apiKey) {
    // MODO TESTE (Dev/Demo sem chave SMS)
    smsCooldownMap.set(tel, agora);
    return { ok: true, demo_codigo: codigo };
  }

  smsCooldownMap.set(tel, agora);
  await enviarSMS(tel, `Liga Vitoria Consorcio: seu codigo de verificacao e ${codigo}. Valido por 5 min.`);
  return { ok: true };
}

async function handleVerifyOtp(body) {
  const tel = telefoneValido(body.telefone);
  if (!tel) return { ok: false, erro: 'Telefone inválido.' };

  const codigoReq = String(body.codigo || '').replace(/\D/g, '');
  const cached = memoryCache.get(`otp_${tel}`);
  const skipSms = getEnv('SKIP_SMS_VERIFICATION', 'true') === 'true';

  if (!skipSms) {
    if (!cached || cached.codigo !== codigoReq || Date.now() > cached.exp) {
      return { ok: false, erro: 'Código inválido ou expirado.' };
    }
  }

  const uuid = crypto.randomUUID();
  let kommoLeadId = null;

  // 1. Busca por telefone existente ou cria Lead em Triagem no Kommo CRM
  try {
    kommoLeadId = await kommo.buscarOuCriarLeadKommo(body.nome, body.email, tel, body.tipo, body.utms);
  } catch (e) {
    console.error('Erro buscarOuCriarLeadKommo:', e);
  }

  // 2. Grava no Google Sheets (se configurado)
  await gravarGoogleSheets({
    nome: body.nome,
    email: body.email,
    telefone: tel,
    tipo: body.tipo,
    dispositivo: body.dispositivo,
    url: body.url,
    uuid: uuid,
    status: 'lead verificado',
    kommo_lead_id: kommoLeadId
  });

  // Limpa OTP usado
  memoryCache.delete(`otp_${tel}`);

  return { ok: true, uuid, kommo_lead_id: kommoLeadId };
}

async function handleGetPlans(body) {
  const valor = Number(body.valor);
  if (!(valor > 0)) return { ok: false, erro: 'Valor inválido.' };

  const tipoRaw = String(body.tipo || '').toLowerCase();
  const tabela = (tipoRaw === 'auto' || tipoRaw === 'automóvel') ? 'Auto' : 'Imovel';
  const airtableToken = getEnv('AIRTABLE_TOKEN');

  if (!airtableToken) return { ok: false, erro: 'AIRTABLE_TOKEN não configurada.' };

  const consulta = async (faixa) => {
    const filtro = `AND((${valor}*${1 + faixa})>{Credito},(${valor}*${1 - faixa})<{Credito})`;
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_DEFAULT}/${encodeURIComponent(tabela)}?filterByFormula=${encodeURIComponent(filtro)}&sort%5B0%5D%5Bfield%5D=Credito&sort%5B0%5D%5Bdirection%5D=asc&maxRecords=12`;

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${airtableToken}` }
    });
    const jsonResp = await resp.json().catch(() => ({}));
    return (jsonResp.records || []).map(r => r.fields);
  };

  let planos = await consulta(0.10);
  if (!planos.length) planos = await consulta(0.20);

  return { ok: true, planos };
}

async function handleUpdateLead(body) {
  const uuid = String(body.uuid || '');
  const kommoLeadId = body.kommo_lead_id;
  const status = body.status;

  // SOMENTE move para Transmissão no Kommo CRM e grava no Google Sheets se o usuário preencheu a Proposta Completa!
  if (status === 'proposta enviada' && body.proposta) {
    if (kommoLeadId) {
      try {
        await kommo.atualizarLeadKommo(kommoLeadId, body.valor);
      } catch (e) {
        console.error('Erro ao mover lead para Transmissão no Kommo:', e);
      }
    }

    try {
      const p = body.proposta || {};
      await gravarGoogleSheets({
        nome: body.nome || p.nome_completo,
        email: body.email,
        cpf: p.cpf,
        telefone: body.telefone,
        tipo: body.tipo,
        valor: body.valor,
        plano: body.plano,
        descricao: body.descricao,
        credito: body.credito,
        parcela: body.parcela,
        pontos: body.pontos,
        dispositivo: body.dispositivo,
        url: body.url,
        nome_completo: p.nome_completo,
        nascimento: p.nascimento,
        rg: p.rg,
        orgao: p.orgao,
        naturalidade: p.naturalidade,
        nome_mae: p.nome_mae,
        endereco: p.endereco,
        cep: p.cep,
        remuneracao_atual: p.remuneracao_atual,
        estado_civil: p.estado_civil,
        nome_completo_do_conjuge: p.nome_completo_do_conjuge,
        cpf_do_conjuge: p.cpf_do_conjuge,
        data_nascimento_conjuge: p.data_nascimento_conjuge,
        metodo_pagamento_1_parcela: p.metodo_pagamento_1_parcela,
        metodo_pagamento_demais_parcela: p.metodo_pagamento_demais_parcela,
        profissao: p.profissao,
        uuid: uuid,
        status: 'proposta enviada',
        kommo_lead_id: kommoLeadId
      });
    } catch (eSheets) {
      console.error('Erro ao gravar proposta no Google Sheets:', eSheets);
    }
  }

  return { ok: true };
}

// Export da Vercel Serverless Handler
module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
  }

  try {
    let body = req.body || {};
    if (Buffer.isBuffer(body)) {
      try { body = body.toString('utf8'); } catch (e) {}
    }
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }
    const action = body.action;

    let responseData = { ok: false, erro: 'Ação inválida.' };

    if (action === 'send_otp') {
      responseData = await handleSendOtp(body);
    } else if (action === 'verify_otp') {
      responseData = await handleVerifyOtp(body);
    } else if (action === 'get_plans') {
      responseData = await handleGetPlans(body);
    } else if (action === 'update_lead') {
      responseData = await handleUpdateLead(body);
    }

    return res.status(200).json(responseData);
  } catch (err) {
    console.error('Erro no servidor /api/simulador:', err);
    return res.status(500).json({ ok: false, erro: 'Erro interno no servidor.' });
  }
};
