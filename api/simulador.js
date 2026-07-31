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

// Configurações Padrão
const SPREADSHEET_ID_DEFAULT = '1FeMY6hfwSix7YR_ndVVxFjcqt2D4JaPWtd38Qc4wP3k';
const AIRTABLE_BASE_DEFAULT = 'appAXa666ayzjld9S';
const KOMMO_SUBDOMAIN_DEFAULT = 'gustavoligavitoriacom';
const KOMMO_STAGE_TRANSMISSAO_DEFAULT = 109093615;
const KOMMO_PIPELINE_ID_DEFAULT = 14131759;

// Parâmetros OTP
const OTP_MIN = 1500, OTP_RANGE = 8000;
const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutos

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

// Helper para chamadas à API v4 do Kommo CRM
async function conectarKommo(endpoint, method, payload) {
  let token = getEnv('KOMMO_TOKEN');
  if (!token) return null;

  // Sanitização do Token (remove aspas, espaços e prefixos duplicados)
  token = token.replace(/^Bearer\s+/i, '').replace(/["']/g, '').trim();

  const subdominio = getEnv('KOMMO_SUBDOMAIN', KOMMO_SUBDOMAIN_DEFAULT);
  const url = `https://${subdominio}.kommo.com/api/v4/${endpoint.replace(/^\//, '')}`;

  try {
    const resp = await fetch(url, {
      method: method.toUpperCase(),
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: payload ? JSON.stringify(payload) : undefined
    });

    const data = await resp.json().catch(() => ({}));
    if (resp.ok) {
      return data;
    } else {
      console.error(`Kommo API Error (${resp.status}):`, JSON.stringify(data));
      return null;
    }
  } catch (err) {
    console.error('Kommo API Exception:', err);
    return null;
  }
}

// Cria Lead em Triagem no Kommo CRM (2 Passos: Lead + Contato Vinculado)
async function criarLeadKommo(nome, email, telefone, tipo) {
  const pipelineId = Number(getEnv('KOMMO_PIPELINE_ID', KOMMO_PIPELINE_ID_DEFAULT));

  // Passo 1: Criar o Lead (Negócio) na etapa Triagem
  const payloadLead = [
    {
      name: `Consórcio ${tipo || 'Imóvel'} - ${nome || 'Lead'}`,
      pipeline_id: pipelineId
    }
  ];

  const respLead = await conectarKommo('leads', 'post', payloadLead);
  const leadId = respLead?._embedded?.leads?.[0]?.id || respLead?.[0]?.id;

  if (!leadId) {
    console.error('Falha ao criar Lead no Kommo CRM.');
    return null;
  }

  // Passo 2: Criar o Contato com Telefone/Email e Vincular ao Lead criado
  try {
    const payloadContato = [
      {
        name: nome || 'Cliente',
        custom_fields_values: [
          { field_code: 'PHONE', values: [{ value: telefone }] },
          { field_code: 'EMAIL', values: [{ value: email }] }
        ],
        _embedded: {
          leads: [{ id: leadId }]
        }
      }
    ];

    await conectarKommo('contacts', 'post', payloadContato);
  } catch (errContato) {
    console.error('Erro ao vincular contato no Kommo:', errContato);
  }

  return leadId;
}

// Atualiza Lead para Transmissão no Kommo CRM
async function atualizarLeadKommo(leadId, valor, tipo, nomeCompleto) {
  const stageId = Number(getEnv('KOMMO_STAGE_TRANSMISSAO', KOMMO_STAGE_TRANSMISSAO_DEFAULT));
  const pipelineId = Number(getEnv('KOMMO_PIPELINE_ID', KOMMO_PIPELINE_ID_DEFAULT));

  const payload = [
    {
      id: Number(leadId),
      name: `🔥 PROPOSTA ${tipo || 'Imóvel'} - ${nomeCompleto || 'Cliente'}`,
      price: Number(valor || 0),
      pipeline_id: pipelineId,
      status_id: stageId
    }
  ];

  return await conectarKommo('leads', 'patch', payload);
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

// Gravação no Google Sheets (se as credenciais de conta de serviço estiverem presentes)
async function gravarGoogleSheets(camposLinha) {
  const clientEmail = getEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  let privateKey = getEnv('GOOGLE_PRIVATE_KEY');

  if (!clientEmail || !privateKey) return;
  privateKey = privateKey.replace(/\\n/g, '\n');

  try {
    const auth = new google.auth.JWT(
      clientEmail,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/spreadsheets']
    );

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = getEnv('GOOGLE_SPREADSHEET_ID', SPREADSHEET_ID_DEFAULT);

    const values = [[
      new Date().toISOString(),
      camposLinha.nome || '',
      camposLinha.email || '',
      camposLinha.cpf || '',
      camposLinha.telefone || '',
      camposLinha.tipo || '',
      camposLinha.valor || '',
      camposLinha.plano || '',
      camposLinha.descricao || '',
      camposLinha.credito || '',
      camposLinha.parcela || '',
      camposLinha.pontos || '',
      camposLinha.dispositivo || '',
      camposLinha.url || '',
      camposLinha.nome_completo || '',
      camposLinha.nascimento || '',
      camposLinha.rg || '',
      camposLinha.orgao || '',
      camposLinha.naturalidade || '',
      camposLinha.nome_mae || '',
      camposLinha.endereco || '',
      camposLinha.cep || '',
      camposLinha.uuid || '',
      camposLinha.status || '',
      camposLinha.kommo_lead_id || ''
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Leads!A:Y',
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });
  } catch (err) {
    console.error('Google Sheets Error:', err);
  }
}

// Handlers das Ações
async function handleSendOtp(body) {
  const tel = telefoneValido(body.telefone);
  if (!tel) return { ok: false, erro: 'Telefone inválido.' };

  const skipSms = getEnv('SKIP_SMS_VERIFICATION', 'true') === 'true';
  const codigo = codigoOtp();
  memoryCache.set(`otp_${tel}`, { codigo, exp: Date.now() + OTP_TTL_MS });

  if (skipSms) {
    return { ok: true, demo_codigo: `${codigo} (Qualquer código aceito)` };
  }

  const apiKey = getEnv('SMS_API_KEY');
  if (!apiKey) {
    // MODO TESTE (Dev/Demo sem chave SMS)
    return { ok: true, demo_codigo: codigo };
  }

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

  // 1. Cria Lead em Triagem no Kommo CRM diretamente
  try {
    kommoLeadId = await criarLeadKommo(body.nome, body.email, tel, body.tipo);
  } catch (e) {
    console.error('Erro criarLeadKommo:', e);
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

  if (body.proposta && kommoLeadId) {
    try {
      await atualizarLeadKommo(kommoLeadId, body.valor, body.tipo, body.proposta.nome_completo);
    } catch (e) {
      console.error('Erro atualizarLeadKommo:', e);
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
