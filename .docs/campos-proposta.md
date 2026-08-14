# Especificação dos Campos da Proposta e Mapeamento Google Sheets

Documentação técnica referente aos campos coletados no formulário final de proposta (`formProposta()`) do Simulador de Consórcio e o seu mapeamento com as colunas gravadas na planilha Google Sheets.

---

## 📋 Tabela de Campos e Colunas na Planilha

| Campo Interno (JS) | Rótulo / Descrição no Form | Validação Frontend / Opções | Nome Exato da Coluna no Google Sheets |
| :--- | :--- | :--- | :--- |
| `nome_completo` | Nome Completo* | Campo obrigatório | `nome_completo` |
| `cpf` | CPF/CNPJ* | `validaCPF` ou `validaCNPJ` | `CPF` |
| `nascimento` | Data de Nascimento* | `validaDataNascimento` (dd/mm/aaaa) | `data_de_nascimento` |
| `rg` | RG* | Campo obrigatório | `rg_doc` |
| `orgao` | Órgão Emissor* | Campo obrigatório | `orgao_emissor` |
| **`data_emissao_rg`** | Data de Emissão do RG* | `validaDataNascimento` (dd/mm/aaaa) | **`data_de_emissao_do_rg`** |
| `naturalidade` | Naturalidade* | Select UF + Cidade (BrasilAPI) | `naturalidade` |
| `nome_mae` | Nome Completo da Mãe* | Campo obrigatório | `nome_completo_da_mae` |
| `endereco` | Endereço Completo* | Campo obrigatório | `endereco_completo` |
| `cep` | CEP* | Máscara de CEP (xxxxx-xxx) | `cep` |
| **`remuneracao_atual`** | Remuneração / Renda Mensal* | Máscara de valor/milhar | **`remuneracao_atual`** |
| **`profissao`** | Profissão* | Campo obrigatório | **`profissao`** |
| **`estado_civil`** | Estado Civil* | Selection (`Solteiro(a)`, `Casado(a)`, `União Estável`, `Divorciado(a)`, `Viúvo(a)`, `Separado(a)`) | **`estado_civil`** |
| **`nome_completo_do_conjuge`** | Nome Completo do Cônjuge | Obrigatório se Casado/União Estável | **`nome_completo_do_conjuge`** |
| **`cpf_do_conjuge`** | CPF do Cônjuge | `validaCPF` se Casado/União Estável | **`cpf_do_conjuge`** |
| **`data_nascimento_conjuge`** | Data Nasc. Cônjuge | `validaDataNascimento` se Casado/União Estável | **`data_nascimento_conjuge`** |
| **`metodo_pagamento_1_parcela`** | Forma de Pagamento (1ª Parcela)* | Selection (`Cartão Porto`, `Cartão de Crédito`, `Boleto Bancário`) | **`metodo_pagamento_1_parcela`** |
| **`metodo_pagamento_demais_parcela`** | Forma de Pagamento (Demais)* | Selection (`Cartão Porto`, `Cartão de Crédito`, `Boleto Bancário`) | **`metodo_pagamento_demais_parcela`** |

---

## ⚙️ Funcionamento Condicional (Cônjuge)

Quando o usuário seleciona **"Casado(a)"** ou **"União Estável"** no campo `estado_civil`:
1. O contêiner de dados do cônjuge (`#conjuge_container`) é exibido visualmente.
2. Os campos `nome_completo_do_conjuge`, `cpf_do_conjuge` e `data_nascimento_conjuge` passam a ser validados e obrigatórios.
3. Se o usuário alterar para outro estado civil (ex: Solteiro(a)), a seção é oculta e os campos são zerados no envio.
