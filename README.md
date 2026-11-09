# Estuda+

Plataforma gratuita de organização de estudos para concursos, adaptada para Android, iPhone e computador. Não utiliza inteligência artificial.

## Ferramentas

1. Biblioteca de PDFs e leitor página por página.
2. Páginas favoritas dentro das apostilas.
3. Caderno com anotações individuais por página e exportação.
4. Cronômetro de estudos com registro de sessões.
5. Checklist do edital por matéria e assunto.
6. Planejador semanal de estudos.
7. Agenda de revisões, inclusive ciclos de 1, 7 e 30 dias a partir das anotações do PDF.
8. Painel de desempenho com histórico e gráficos semanais.
9. Notas rápidas.
10. Metas diárias e semanais.

## Armazenamento e privacidade

- PDFs e dados são guardados localmente no aparelho usando IndexedDB.
- O salvamento de anotações e ferramentas ocorre automaticamente.
- O backup exporta os dados e os PDFs para um arquivo JSON que pode ser restaurado em outro aparelho.
- Os dados não são sincronizados entre aparelhos.
- O navegador pode limitar ou remover dados locais; mantenha cópias de backup.

## Instalação

O projeto é uma PWA estática. Publique os arquivos em uma hospedagem HTTPS.

- Android: abra no Chrome e escolha Instalar aplicativo / Adicionar à tela inicial.
- iPhone: abra no Safari, toque em Compartilhar e escolha Adicionar à Tela de Início.

Na primeira utilização, conecte-se à internet para carregar e armazenar a biblioteca PDF.js. Depois, o leitor pode funcionar offline se os recursos estiverem em cache.

## Desenvolvimento

Arquivos principais: `index.html`, `styles.css`, `app.js`, `manifest.webmanifest`, `sw.js`.