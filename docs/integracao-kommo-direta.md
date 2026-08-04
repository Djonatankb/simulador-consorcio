# Integração Direta Google Apps Script ➔ Kommo CRM (API v4)

Documentação da arquitetura **direta** entre o backend Google Apps Script ([backend-apps-script.gs](file:///c:/Users/Liga%20Vit%C3%B3ria%20MKT/Desktop/Simulador%20Cons%C3%B3rcio/simulador-consorcio/backend-apps-script.gs)) e a API v4 do **Kommo CRM**, eliminando completamente o n8n.

---

## 🎯 Arquitetura da Integração

```mermaid
sequenceDiagram
    autonumber
    actor Cliente as Usuário (Chat no Site)
    participant Backend as Apps Script (/exec)
    participant Sheets as Google Sheets
    participant Kommo as CRM Kommo (API v4)

    Cliente->>Backend: 1. verify_otp (SMS Válido)
    Backend->>Kommo: 2. POST /api/v4/leads (Cria/Move Lead na fase Validar Oportunidade com a TAG "Simulador Consórcio")
    Kommo-->>Backend: 3. Retorna { id: 15359565 }
    Backend->>Sheets: 4. Salva kommo_lead_id (15359565) na planilha

    Cliente->>Backend: 5. update_lead (Proposta Submetida)
    Backend->>Sheets: 6. Recupera kommo_lead_id (15359565)
    Backend->>Kommo: 7. PATCH /api/v4/leads (Move para Transmissão em ~300ms)
```

---

## 🏷️ Tags atribuídas no Kommo CRM

- **`Simulador Consórcio`**: Atribuída automaticamente na primeira criação ou atualização do lead ao entrar na etapa de **Validar Oportunidade** (estágio inicial `109093611`).

---

## 🔑 Configuração das Propriedades do Script (Google Apps Script)

Para ativar a integração direta, acesse no editor do Google Apps Script:
**⚙ Configurações do projeto** ➔ **Propriedades do script** ➔ Adicionar propriedade:

* **`KOMMO_TOKEN`**: Token de Acesso de Longa Duração (Bearer Token do Kommo).
* **`KOMMO_SUBDOMAIN`**: `gustavoligavitoriacom` (opcional, padrão).
* **`KOMMO_STAGE_TRANSMISSAO`**: `109093615` (opcional, padrão).
* **`KOMMO_PIPELINE_ID`**: `14131759` (opcional, padrão).

---

## 🚀 Como Atualizar o Backend no Google Apps Script

No editor do Apps Script ([Leads do Consórcio - Landbot](https://docs.google.com/spreadsheets/d/1FeMY6hfwSix7YR_ndVVxFjcqt2D4JaPWtd38Qc4wP3k/edit)):

1. Copie todo o código do arquivo [backend-apps-script.gs](file:///c:/Users/Liga%20Vit%C3%B3ria%20MKT/Desktop/Simulador%20Cons%C3%B3rcio/simulador-consorcio/backend-apps-script.gs).
2. Cole no arquivo de código do Apps Script (Extensões ➔ Apps Script).
3. Clique em **Implantar** ➔ **Gerenciar implantações** ➔ Clique no ícone de lápis (Editar) ➔ Selecione **"Nova versão"** ➔ Clique em **Implantar**.
