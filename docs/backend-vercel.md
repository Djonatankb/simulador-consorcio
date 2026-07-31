# Backend Serverless Vercel (`/api/simulador`) — Guia Completo e Definitivo

Documentação da arquitetura **Vercel Serverless Function** ([api/simulador.js](file:///c:/Users/Liga%20Vit%C3%B3ria%20MKT/Desktop/Simulador%20Cons%C3%B3rcio/simulador-consorcio/api/simulador.js)), que roda nativamente no mesmo domínio do frontend (`https://livelo.ligavitoria.com.br/api/simulador`).

---

## 🎯 Arquitetura da Solução

```mermaid
sequenceDiagram
    autonumber
    actor Cliente as Usuário (Simulador)
    participant Vercel as API Vercel (/api/simulador)
    participant Kommo as CRM Kommo (API v4)
    participant Comtele as SMS Comtele
    participant Airtable as Tabela de Planos
    participant Sheets as Google Sheets API

    Cliente->>Vercel: POST send_otp (Telefone)
    Vercel->>Comtele: Envia SMS com o código OTP

    Cliente->>Vercel: POST verify_otp (Nome, Email, Telefone, Código)
    Vercel->>Kommo: POST /api/v4/leads/complex (Cria Lead na Triagem)
    Kommo-->>Vercel: Retorna ID do Lead
    Vercel->>Sheets: Grava Lead na planilha com o kommo_lead_id

    Cliente->>Vercel: POST update_lead (Proposta Submetida)
    Vercel->>Kommo: PATCH /api/v4/leads (Move pra Transmissão em <100ms)
    Vercel->>Sheets: Atualiza proposta na planilha
```

---

## 🔑 Variáveis de Ambiente na Vercel (Environment Variables)

Acesse o painel da Vercel: **Project Settings** ➔ **Environment Variables** e adicione:

| Nome da Variável | Descrição | Exemplo / Valor Padrão |
| :--- | :--- | :--- |
| `KOMMO_TOKEN` | Bearer Token de Longa Duração do Kommo CRM | `eyJ0eXAiOiJKV1Q...` |
| `KOMMO_SUBDOMAIN` | Subdomínio da conta no Kommo | `gustavoligavitoriacom` |
| `KOMMO_STAGE_TRANSMISSAO` | ID da etapa "Transmissão" | `109093615` |
| `KOMMO_PIPELINE_ID` | ID do Funil no Kommo | `14131759` |
| `SMS_API_KEY` | Chave de API da Comtele SMS | *(Chave Comtele)* |
| `AIRTABLE_TOKEN` | Token Personal Access do Airtable | *(Token Airtable)* |
| `GOOGLE_SPREADSHEET_ID` | ID da planilha Google Sheets | `1FeMY6hfwSix7YR_ndVVxFjcqt2D4JaPWtd38Qc4wP3k` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | E-mail da Conta de Serviço GCP | `simulador@...iam.gserviceaccount.com` |
| `GOOGLE_PRIVATE_KEY` | Chave Privada da Conta de Serviço | `-----BEGIN PRIVATE KEY-----\n...` |

---

## 🚀 Como Fazer o Deploy para a Vercel

Seja pelo **Vercel CLI** ou via integração automática com o **GitHub**:

```bash
# Deploy direto via Vercel CLI:
vercel --prod
```

Quando implantado, o simulador em `https://livelo.ligavitoria.com.br/simulador-consorcio/` enviará todas as requisições para a rota interna `/api/simulador` com resposta em menos de 100ms, sem n8n e sem Google Apps Script!
