# Documentação Técnica da Integração Kommo CRM (API v4)

Esta documentação descreve o funcionamento técnico e os detalhes dos endpoints consumidos para a integração com a API v4 do **Kommo CRM**.

---

## 🎯 Visão Geral do Fluxo

A integração gerencia a criação, atualização e vinculação automática de Leads e Contatos no Kommo CRM a partir das interações do usuário no Simulador de Consórcio.

### Regras de Negócio Implementadas:
1. **Deduplicação de Contatos**: O sistema consulta se o telefone do usuário já possui um Contato no Kommo CRM (`GET /api/v4/contacts?query={telefone}`).
2. **Atualização de Contatos**: Caso o contato já exista, seu nome e e-mail são atualizados para manter os dados sincronizados sem duplicar cadastros.
3. **Preservação de Fase do Lead**: Se o contato possuir um Lead ativo em fase avançada (fora de Triagem), o estágio do Lead é preservado.
4. **Vinculação Explícita de Entidades**: Todo novo Lead criado é explicitamente vinculado ao Contato correspondente utilizando o **Link Endpoint** da API v4 do Kommo CRM.

---

## 🔗 Endpoint de Vinculação (Link API)

Na API v4 do Kommo CRM, chamadas `POST` padrão para `/leads` ou `/contacts` ignoram a propriedade `_embedded` para relacionamento de entidades existentes. Para criar a associação entre Lead e Contato, é utilizado o endpoint dedicado:

- **Método**: `POST`
- **URL**: `https://{subdomain}.kommo.com/api/v4/leads/{lead_id}/link`
- **Headers**:
  - `Authorization: Bearer {token}`
  - `Content-Type: application/json`
- **Payload**:
  ```json
  [
    {
      "to_entity_id": 1234567,
      "to_entity_type": "contacts",
      "metadata": {
        "is_main": true
      }
    }
  ]
  ```

---

## 🛠️ Funções do Módulo `lib/kommo.js`

| Função | Descrição | Endpoint Kommo Utilizado |
| :--- | :--- | :--- |
| `conectarKommo(endpoint, method, payload)` | Cliente HTTP genérico autenticado com Bearer Token. | `/api/v4/*` |
| `vincularContatoLeadKommo(leadId, contactId)` | Vincula um Contato a um Lead. | `POST /api/v4/leads/{leadId}/link` |
| `adicionarNotaUtmKommo(leadId, utms)` | Adiciona nota com dados de rastreamento UTM. | `POST /api/v4/leads/{leadId}/notes` |
| `buscarOuCriarLeadKommo(nome, email, telefone, tipo, utms)` | Busca contato por telefone, cria/atualiza Lead e vincula. | `GET /contacts`, `POST /leads`, `POST /contacts`, `POST /leads/{id}/link` |
| `criarLeadKommo(nome, email, telefone, tipo, stageId, utms)` | Cria Lead e Contato novos e realiza a vinculação. | `POST /leads`, `POST /contacts`, `POST /leads/{id}/link` |
| `atualizarLeadKommo(leadId, valor)` | Move o Lead para a fase de Transmissão com valor final. | `PATCH /api/v4/leads` |

---

## 🔄 Backend Google Apps Script (`backend-apps-script.gs`)

O backend Google Apps Script espelha esta mesma lógica técnica através das funções `conectarKommo`, `criarLeadKommo`, `vincularContatoLeadKommo` e `atualizarLeadKommo`.

Para atualizar a versão de produção no Google Apps Script:
1. Copie o conteúdo de [backend-apps-script.gs](file:///c:/Users/Liga%20Vit%C3%B3ria%20MKT/Desktop/Simulador%20Cons%C3%B3rcio/simulador-consorcio/backend-apps-script.gs).
2. Acesse o projeto no Google Apps Script.
3. Cole o código atualizado.
4. Clique em **Implantar** ➔ **Gerenciar Implantações** ➔ **Editar** ➔ **Nova versão** ➔ **Implantar**.
