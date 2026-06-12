# Final Genesis

Prototipo inicial de tela mobile vertical para um jogo de luta por turnos.

O projeto atual abre pelo menu visual legado em `/`, preserva o prototipo mobile original em `prototype/mobile-layout/` e usa a base web Vite + TypeScript para os fluxos online em `/online/`. A referencia visual esta em `assets/reference/concept-battle-mobile.png` e o GDD esta em `GDD_Jogo_Luta_Turnos_Completo.pdf`.

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

- Tela inicial legado como entrada principal do jogo.
- Botao `ONLINE` no menu legado leva ao app online em `/online/`.
- Online exige login Google.
- Menu online autenticado com `Jogar Online`, `Ranking` e `Perfil`.
- Perfil com conta, ranking, streak e personagem selecionado.
- Selecao de personagem com bloqueios e requisitos.
- Lobby online com ranked e partida privada por codigo/link.
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

Sem `.env`, o app online roda em modo local demo. Para conectar ao Supabase real:

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
- `npm run android:sync`: build web e sincronizacao do Capacitor Android.
- `npm run android:apk`: gera APK debug em `android/app/build/outputs/apk/debug/app-debug.apk`.
- `npm run android:aab`: gera AAB release assinado em `android/app/build/outputs/bundle/release/app-release.aab`.

## Android

O projeto Android usa Capacitor com:

- App ID: `com.malganiplay.finalgenesis`
- Nome: `Final Genesis`
- Web dir: `dist`
- Target SDK: Android 36
- Orientacao: portrait
- Redirect nativo de Auth: `com.malganiplay.finalgenesis://auth/callback`

Requisito local para build Android: JDK 21 e Android SDK instalado.

No Windows, antes de gerar APK/AAB nesta maquina:

```powershell
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
```

Comandos principais:

```bash
npm run android:sync
npm run android:apk
npm run android:aab
```

Arquivos gerados:

- APK debug: `android/app/build/outputs/apk/debug/app-debug.apk`
- AAB release: `android/app/build/outputs/bundle/release/app-release.aab`
- Icone Play 512x512: `assets/store/final-genesis-icon-512.png`

A chave de upload local fica fora do Git em `android/keystores/` e `android/release-signing.properties`. Faca backup seguro desses arquivos, porque a Play Console vai depender dessa chave para novos envios.

Para o login Google funcionar no APK, o redirect `com.malganiplay.finalgenesis://auth/callback` tambem esta liberado no painel remoto do Supabase Auth.

Estado da Play Console:

- Conta: `MALGANY PLAY©`
- App criado: `Final Genesis`
- Package: `com.malganiplay.finalgenesis`
- Status: teste interno ativo
- Teste interno: versao `1.0.1`, codigo `2`, disponivel para testadores internos
- Lista de testadores: `Final Genesis - teste interno`
- Testadores: `yopsadida@gmail.com`, `thiagoleite1993@gmail.com`
- Link de participacao: `https://play.google.com/apps/internaltest/4700337006519489256`

Observacao: ate a revisao completa do app, os testadores podem ver o nome temporario `com.malganiplay.finalgenesis (unreviewed)` na Google Play.

## Supabase

Projeto remoto configurado:

- Projeto: `Final Genesis`
- Ref: `xkynbtwnopsbwkoqhadt`
- URL: `https://xkynbtwnopsbwkoqhadt.supabase.co`
- Auth: Google OAuth habilitado; Anonymous Sign-ins e manual linking desabilitados.
- Redirect principal: `https://final-genesis-web.vercel.app/auth/callback`

Arquivos versionados:

- `supabase/migrations/20260609190000_initial_online_schema.sql`
- `supabase/functions/*`
- `supabase/config.toml`

Fluxo esperado:

1. Criar um projeto Supabase novo dedicado ao jogo.
2. Aplicar a migration.
3. Deployar as Edge Functions.
4. Habilitar Google OAuth.
5. Configurar redirects para localhost, Vercel producao e previews.
6. Copiar URL e anon key para `.env` local e variaveis da Vercel.

## Deploy

- Producao Vercel: `https://final-genesis-web.vercel.app`
- Menu legado: `https://final-genesis-web.vercel.app/`
- Online: `https://final-genesis-web.vercel.app/online/`
- Projeto Vercel: `final-genesis-web`
- Variaveis configuradas em Production e Development:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

Validacoes realizadas no remoto:

- Login Google.
- Lobby online com ranked e privada para conta Google.
- Criacao de sala privada por codigo/link.
- Ranked com dois usuarios temporarios via Edge Functions: fila, match, acao oculta ate ambos escolherem, revelacao do turno, abandono e atualizacao de ranking.

## Proximos passos recomendados

1. Instalar pelo link de teste interno em um aparelho Android real e testar login.
2. Testar lobby e uma partida privada com as duas contas de teste.
3. Testar ranked com duas contas Google reais simultaneas.
4. Preencher a ficha completa da Play Console para remover o nome temporario e preparar revisao.
5. Refinar a cena de batalha visual usando mais animacoes do prototipo legado.
