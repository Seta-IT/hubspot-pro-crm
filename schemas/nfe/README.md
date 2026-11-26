# Schemas XSD oficiais da NF-e (PL_010g)

Cópia dos schemas oficiais do Portal Nacional da NF-e (pacote de liberação PL_010g, com os grupos
IBS/CBS da reforma tributária), obtidos do repositório nfephp-org/sped-nfe (commit 17ca8d2d66b0e12148876c3f1faf5aef328cd0de,
04/11/2026, `schemes/PL_010g`). Só os arquivos necessários para NF-e 4.00, enviNFe, consultas,
eventos de cancelamento e CC-e.

Uso: apenas nos testes automatizados (`tests/sefaz-nfe.test.ts`, via `xmllint-wasm`) para validar
o XML gerado e assinado antes de qualquer transmissão. Não são carregados em produção.
