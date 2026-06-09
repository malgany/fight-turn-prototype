# Final Genesis

Prototipo inicial de tela mobile vertical para um jogo de luta por turnos.

O projeto atual tem uma base web Vite + TypeScript para os fluxos online e preserva o prototipo mobile original em `prototype/mobile-layout/`. A referencia visual esta em `assets/reference/concept-battle-mobile.png` e o GDD esta em `GDD_Jogo_Luta_Turnos_Completo.pdf`.

## Resumo do GDD

- Dois jogadores escolhem acoes ao mesmo tempo.
- Depois da confirmacao, as acoes sao reveladas e resolvidas automaticamente.
- Estados principais: Neutro, PLUS, Punido, Derrubado e Golpe Garantido.
- Acoes: Poke, Combo, Agarrao, Especial, ULTIMATE, Bloqueio, Abaixar e Pulo.
- O resultado depende de velocidade, PLUS, defesa/movimento, dano, barra de ULTIMATE e regras especiais como trade, derrubada e golpe garantido.

## Decisao tecnica

HTML e CSS puro foram adequados para o primeiro estudo visual, mas a implementacao online agora usa Vite + TypeScript.

Para continuar evoluindo o jogo 2D jogavel, a direcao tecnica e:

- TypeScript para modelar regras de turno, acoes, estados e testes.
- Vite para desenvolvimento local rapido e build web.
- Supabase para Auth, Postgres, Realtime e Edge Functions.
- Phaser 3 pode ser avaliado depois para uma cena de batalha mais avancada, mas nao e dependencia do online web atual.

Motivo: o conceito depende de uma matriz de resolucao de acoes, estados persistentes, animacoes sincronizadas, feedback visual e entrada por toque. Phaser cobre essas necessidades sem o peso de uma engine 3D/nativa. HTML/CSS pode continuar sendo usado como referencia de UI, documentacao visual ou overlay, mas a logica do jogo deve ficar separada e testavel.

Outros caminhos possiveis:

- PixiJS: bom se o projeto precisar apenas de renderizacao 2D customizada, mas exige montar mais sistemas ao redor.
- Godot: boa opcao se o objetivo for app nativo/mobile desde cedo, editor visual e pipeline de cenas.
- Unity: viavel, mas provavelmente pesado para este escopo inicial de jogo 2D por turnos.

## Estrutura

- `GDD_Jogo_Luta_Turnos_Completo.pdf`: regras e estrutura principal do jogo.
- `assets/reference/`: imagens de referencia e estudos visuais.
- `assets/backgrounds/`: cenarios da arena.
- `assets/ui/`: paineis, botoes, HUD e icones.
- `assets/characters/`: sprites, animacoes e JSONs dos personagens.
- `src/`: app web Vite + TypeScript, telas, servicos e regras de dominio.
- `supabase/`: migrations SQL, configuracao e Edge Functions do backend online.
- `prototype/mobile-layout/`: estudo navegavel da tela de batalha mobile.
- `tools/serve-prototype.mjs`: servidor local simples para abrir o prototipo.

## Formato de assets

- Use WebP para imagens ativas no prototipo web: sprites, sequencias de frames, cenario, paineis e botoes, incluindo assets com transparencia.
- Mantenha PNG apenas como fonte, referencia ou backup em pastas `old/` quando for necessario preservar o asset original.
- Antes de adicionar uma animacao por frames, confira o peso total da pasta. O idle atual do ninja usa 45 frames WebP em `assets/characters/ninja-idle/`.

## App web atual

- Tela de login com Google e convidado anonimo.
- Menu autenticado com perfil, online, ranking, historico indireto pelo menu e prototipo local.
- Perfil com conta, ranking, streak, personagem selecionado e vinculo Google para convidado.
- Selecao de personagem com bloqueios e requisitos.
- Lobby online com ranked bloqueado para convidado e partida privada por codigo/link.
- Batalha online visual com acoes ocultas ate resolucao, timer, HUD, vida, ULTIMATE e resultado de turno.
- Tela de ranking e historico.
- Adaptador local demo quando Supabase ainda nao esta configurado.
- Supabase real quando `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` existem.

## Prototipo legado

- O prototipo possui menu inicial, ajuda, opcoes e selecao de personagem.
- A selecao atual escolhe P1 e P2 antes da luta local.
- O jogador controla o personagem da esquerda.
- O personagem da direita escolhe acoes automaticamente fora do debug local.
- Cada turno normal dura 5 segundos.
- Golpe garantido dura 3 segundos.
- Ao final do tempo, as acoes escolhidas sao resolvidas e o dano reduz a vida de 100%.
- ULTIMATE exige 3 segmentos de barra.
- Ao terminar a luta, aparece um botao para reiniciar.
- Em `localhost`, `127.0.0.1`, `0.0.0.0` ou `::1`, o prototipo ativa um painel de debug local fora da area do jogo. Nesse modo nao ha timer; o turno resolve quando PLAYER e CPU tiverem acoes escolhidas. Em hosts online, como GitHub Pages, o debug fica desativado por padrao.

## Backend online

Como o jogo e por turnos, o MVP online nao precisa de servidor WebSocket dedicado nem sincronizacao a 30/60 FPS. A arquitetura implementada para comecar sem custo e:

- Vercel Hobby: frontend web, painel/admin simples e rotas HTTP leves.
- Supabase Free: Auth, Postgres, tabelas de perfil, ranking, personagens, historico e placar privado.
- Supabase Realtime: fila simples, salas privadas, notificacoes de turno e entrega de acoes.
- Supabase Edge Functions: validacao de acao, resolucao do turno, finalizacao de partida e atualizacao de ranking.

O cliente deve enviar apenas a acao escolhida no turno. O backend deve validar personagem desbloqueado, estado da partida, tempo do turno e resultado. O cliente nao deve gravar vitoria, derrota, pontos de ranking ou desbloqueios diretamente.

Limites relevantes do Supabase Free no momento da avaliacao: 2 projetos ativos gratuitos, 50.000 MAU, 500 MB de banco, 1 GB de storage, 200 conexoes realtime simultaneas, 2.000.000 mensagens realtime por ciclo e 500.000 invocacoes de Edge Functions. Isso e suficiente para um MVP fechado ou beta pequeno se cada turno gerar poucas mensagens.

Vercel continua adequada para o site e APIs curtas, mas nao para hospedar um servidor WebSocket persistente. Se o jogo futuramente precisar de realtime continuo ou baixa latencia competitiva, adicionar um servidor Node.js separado com Socket.IO ou Colyseus.

## Como rodar o app web

Requisito: Node.js 18 ou superior.

No terminal, dentro da pasta do projeto:

```bash
npm install
npm run dev
```

Depois acesse:

```text
http://127.0.0.1:5173
```

Sem `.env`, o app roda em modo local demo. Para conectar ao Supabase real:

```bash
copy .env.example .env
```

Configure:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Scripts

- `npm run dev`: app web Vite.
- `npm run build`: TypeScript + build de producao.
- `npm test`: testes unitarios.
- `npm run prototype`: servidor do prototipo legado.

## Supabase

Arquivos versionados:

- `supabase/migrations/20260609190000_initial_online_schema.sql`
- `supabase/functions/*`
- `supabase/config.toml`

Fluxo esperado:

1. Criar um projeto Supabase novo dedicado ao jogo.
2. Aplicar a migration.
3. Deployar as Edge Functions.
4. Habilitar Google OAuth e Anonymous Sign-ins.
5. Configurar redirects para localhost, Vercel producao e previews.
6. Copiar URL e anon key para `.env` local e variaveis da Vercel.

## Proximos passos recomendados

1. Criar o projeto Supabase remoto e aplicar migrations/functions.
2. Configurar Google OAuth no Google Cloud e Supabase Auth.
3. Criar projeto Vercel e configurar variaveis de ambiente.
4. Testar duas sessoes reais com contas Google diferentes em ranked.
5. Testar sala privada por codigo/link entre dois navegadores.
6. Refinar a cena de batalha visual usando mais animacoes do prototipo legado.
