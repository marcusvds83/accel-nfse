# Accel NFS-e/NF-e

Middleware de emissao propria de NFS-e e NF-e para a **Accel** — Curitiba/PR.

## Arquitetura

```
Odoo (fatura com x_nytro_nfse_status = "pendente")
    | XML-RPC (polling)
Middleware Node.js (Render)
    | certificado A1
Firebase (cofre)
    | XML assinado (SPED NFS-e v1.01 / NF-e SEFAZ)
Governo (SEFIN Nacional / SEFAZ-PR)
    | autorizada
Middleware gera PDF (DANFSe / DANFE)
    | anexa XML + PDF + atualiza status
Odoo (chatter da fatura)
```

## Estrutura do Projeto

```
accel-nfse/
  server.js                  Servidor Express
  config.js                  Configuracoes (env vars)
  package.json
  .env.example               Template de variaveis de ambiente
  services/
    firebase-cert.js         Cofre do certificado A1 no Firebase
    pfx-openssl.js           Fallback OpenSSL para PFX
    nfse-xml.js              Gerador de XML NFS-e
    nfse-signer.js           Assinatura digital XMLDSig
    nfse-client.js           Cliente SEFIN (SPED NFS-e v1.01)
    nfse-cancelamento.js     Cancelamento de NFS-e
    nfse-odoo-emit.js        Polling + integracao Odoo
    nfse-pdf.js              Gerador de DANFSe PDF
  routes/
    nfse-cert.js             Rotas de certificado
    nfse.js                  Rotas de emissao/cancelamento
    dashboard.js             Rotas do painel admin
    admin-tools.js           Ferramentas administrativas
  public/
    index.html               Frontend SPA
    app.js                   Logica do frontend
    styles.css               Estilos
  odoo-scripts/              Scripts de configuracao do Odoo
```

## Deploy no Render

1. Conecte o GitHub ao Render
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Configure as Environment Variables (ver .env.example)
5. O servidor inicia o polling automaticamente

## Firebase Setup

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/)
2. Va em **Project Settings > Service Accounts**
3. Clique em **Generate New Private Key**
4. Copie `project_id`, `client_email` e `private_key` para as env vars
5. O Firestore sera criado automaticamente no primeiro acesso

## Variaveis de Ambiente (Render)

| Variavel | Valor Accel |
|---|---|
| API_KEY | accel-nfse-2026-k3y-su3per-s3cr3t |
| ODOO_URL | https://accel-gpl.odoo.com/ |
| ODOO_DB | accel |
| ODOO_USER | contato@accel-br.com |
| ODOO_API_KEY | 629f0ba46233f60449c11fc4d801402c38a0f13c |
| ODOO_POLLING_MS | 15000 |
| NFSE_CIDADE | Curitiba |
| NFSE_CODIGO_IBGE | 4106902 |
| NFSE_ALIQUOTA_ISS | 5.00 |
| NFSE_C_NBS | 122051900 |
| NFSE_C_TRIB_NAC | 080201 |
| PREF_HOM_URL | https://homologacao.nfse.fazenda.gov.br/ws/NfseServico/NfseServico.svc |
| PREF_PROD_URL | https://nfse.fazenda.gov.br/ws/NfseServico/NfseServico.svc |

## Pendente

- [ ] Firebase: credenciais (aguardando Demetrius)
- [ ] Render: criar servico e configurar env vars
- [ ] Certificado A1: upload via API
- [ ] Logo da empresa: enviar para Firebase
- [ ] Homologacao: testar em ambiente de teste
