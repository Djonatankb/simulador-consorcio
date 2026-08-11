# Documentação do Sistema — Variáveis de Ambiente & Kommo CRM

Este documento registra o mapeamento das variáveis de ambiente do projeto e os identificadores das fases de funil do Kommo CRM.

---

## 📋 Variáveis de Ambiente do Kommo CRM

| Variável | Valor Padrão / ID | Descrição |
| :--- | :--- | :--- |
| `KOMMO_TOKEN` | *(Configurado via .env)* | Token de Acesso (Bearer Token de Longa Duração) do Kommo CRM. |
| `KOMMO_SUBDOMAIN` | `gustavoligavitoriacom` | Subdomínio da conta do Kommo CRM. |
| **`KOMMO_SEM_CONTATO`** | `109917515` | **ID da fase inicial ("Sem Contato")** no funil do Kommo CRM. *(Anteriormente KOMMO_VALIDAR_OPORTUNIDADE=109093611)* |
| `KOMMO_STAGE_TRANSMISSAO` | `109093615` | ID da etapa "Transmissão" no funil do Kommo CRM. |
| `KOMMO_PIPELINE_ID` | `14131759` | ID do Funil de Vendas do Kommo CRM. |

---

- **11/08/2026**:
  - Implementada restrição no módulo [lib/kommo.js](file:///c:/Users/Liga%20Vit%C3%B3ria%20MKT/Desktop/Simulador%20Cons%C3%B3rcio/simulador-consorcio/lib/kommo.js): ao localizar um lead já existente no CRM, sua fase só é alterada para **"Sem Contato"** (`109917515`) caso o lead esteja atualmente nas fases de ID **`109093603`** ou **`109093599`**.
  - Caso o lead existente esteja em uma fase mais avançada do funil, a fase atual é preservada e a tag **`Mensagem Simulador`** não é aplicada, garantindo que o lead não retorne a estágios anteriores nem receba marcações duplicadas de entrada.

