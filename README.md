# Estuda+

Plataforma gratuita de organização de estudos para concursos, adaptada para Android, iPhone e computador. Não utiliza inteligência artificial.

## Ferramentas

1. Biblioteca de PDFs.
2. Leitor de PDF página por página, com anotações individuais.
3. Páginas favoritas dentro das apostilas.
4. Caderno para consultar anotações por página.
5. Cronômetro com tempos predefinidos e duração personalizada.
6. Checklist do edital com marcação de conclusão em um toque.
7. Planejador semanal de estudos.
8. Agenda de revisões, inclusive ciclos de 1, 7 e 30 dias.
9. Painel de desempenho com histórico e gráficos semanais.
10. Metas diárias e semanais.

A ferramenta separada de notas rápidas foi removida para deixar a navegação mais simples. As anotações dentro de cada página do PDF foram mantidas.

## Armazenamento e privacidade

- PDFs e dados são guardados localmente no aparelho usando IndexedDB.
- O salvamento das anotações por página e das ferramentas ocorre automaticamente.
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
