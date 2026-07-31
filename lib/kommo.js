/**
 * Módulo de Integração Direta com Kommo CRM (API v4)
 * Simulador de Consórcio — Liga Vitória
 */

const KOMMO_SUBDOMAIN_DEFAULT = 'gustavoligavitoriacom';
const KOMMO_STAGE_TRANSMISSAO_DEFAULT = 109093615;
const KOMMO_PIPELINE_ID_DEFAULT = 14131759;

function getEnv(key, defaultValue = '') {
  return process.env[key] || defaultValue;
}

/**
 * Realiza chamadas HTTP autenticadas para a API v4 do Kommo CRM
 */
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

/**
 * Atualiza os dados de um Contato já existente no Kommo CRM (Nome e E-mail)
 */
async function atualizarContatoKommo(contactId, nome, email, telefone) {
  if (!contactId) return null;

  const payload = [
    {
      id: Number(contactId),
      name: nome || 'Cliente',
      custom_fields_values: [
        { field_code: 'PHONE', values: [{ value: telefone }] },
        { field_code: 'EMAIL', values: [{ value: email }] }
      ]
    }
  ];

  return await conectarKommo('contacts', 'patch', payload);
}

/**
 * Busca contato existente no Kommo por número de telefone.
 * Se o contato existir: atualiza Nome e E-mail do contato (ZERO contatos duplicados).
 * - Se o contato já tiver um Lead vinculado, retorna o ID do Lead.
 * - Se não tiver Lead vinculado, cria o Lead na Triagem e vincula a este contato existente.
 * Se o contato não existir: cria Lead em Triagem + Contato.
 */
async function buscarOuCriarLeadKommo(nome, email, telefone, tipo) {
  const telLimpo = String(telefone || '').replace(/\D/g, '');
  if (!telLimpo) return null;

  // 1. Busca se o contato já existe no Kommo pelo número de telefone
  try {
    const busca = await conectarKommo(`contacts?query=${encodeURIComponent(telLimpo)}&with=leads`, 'get');
    const contatoExistente = busca?._embedded?.contacts?.[0];

    if (contatoExistente && contatoExistente.id) {
      console.log(`Contato existente localizado no Kommo CRM (ID: ${contatoExistente.id}). Atualizando e-mail/nome...`);

      // Atualiza o E-mail e Nome do contato existente sem criar duplicatas
      await atualizarContatoKommo(contatoExistente.id, nome, email, telLimpo);

      const leadExistenteId = contatoExistente?._embedded?.leads?.[0]?.id;

      if (leadExistenteId) {
        console.log(`Lead existente localizado e vinculado (ID: ${leadExistenteId})`);
        return leadExistenteId;
      } else {
        // Contato existe mas não tem Lead vinculado -> cria Lead na Triagem e vincula ao contato existente
        const pipelineId = Number(getEnv('KOMMO_PIPELINE_ID', KOMMO_PIPELINE_ID_DEFAULT));
        const respLead = await conectarKommo('leads', 'post', [{
          name: `Consórcio ${tipo || 'Imóvel'} - ${nome || 'Lead'}`,
          pipeline_id: pipelineId,
          _embedded: {
            contacts: [{ id: contatoExistente.id }]
          }
        }]);
        return respLead?._embedded?.leads?.[0]?.id || respLead?.[0]?.id;
      }
    }
  } catch (errBusca) {
    console.warn('Erro ao buscar lead/contato existente no Kommo:', errBusca);
  }

  // 2. Se não existir o contato, cria novo Lead na Triagem e novo Contato
  return await criarLeadKommo(nome, email, telLimpo, tipo);
}

/**
 * Cria Lead em Triagem no Kommo e vincula um novo Contato (Nome, E-mail, Telefone)
 */
async function criarLeadKommo(nome, email, telefone, tipo) {
  const pipelineId = Number(getEnv('KOMMO_PIPELINE_ID', KOMMO_PIPELINE_ID_DEFAULT));

  // 1. Criar o Lead na etapa Triagem
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

  // 2. Criar e Vincular Contato ao Lead
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

/**
 * Atualiza o Lead no Kommo CRM: move para Transmissão, define valor e ajusta nome
 */
async function atualizarLeadKommo(leadId, valor, tipo, nomeCompleto) {
  if (!leadId) return null;

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

module.exports = {
  conectarKommo,
  buscarOuCriarLeadKommo,
  criarLeadKommo,
  atualizarContatoKommo,
  atualizarLeadKommo
};
