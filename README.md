# Fight Turn

Prototipo inicial de tela mobile vertical para um jogo de luta por turnos.

O projeto atual valida composicao visual e um loop jogavel simples: HUD superior, arena central, mensagens de resolucao, timer de turno, dano em porcentagem e painel inferior com botoes grandes para toque. A referencia visual esta em `assets/reference/concept-battle-mobile.png` e o GDD esta em `GDD_Jogo_Luta_Turnos_Completo.pdf`.

## Resumo do GDD

- Dois jogadores escolhem acoes ao mesmo tempo.
- Depois da confirmacao, as acoes sao reveladas e resolvidas automaticamente.
- Estados principais: Neutro, Vantagem, Punido e Derrubado.
- Acoes: Poke, Combo, Agarrao, Especial, Super, Bloqueio, Abaixar e Pulo.
- O resultado depende de velocidade, vantagem, defesa/movimento, dano, barra de Super e regras especiais como trade e derrubada.

## Decisao tecnica

HTML e CSS puro sao adequados para este primeiro estudo visual, mas nao sao recomendados como base principal do jogo.

Para continuar o projeto como jogo 2D jogavel, a recomendacao e migrar a implementacao para:

- Phaser 3 para cena 2D, loop de jogo, sprites, animacoes, tweens, input e audio.
- TypeScript para modelar regras de turno, acoes, estados e testes com mais seguranca.
- Vite para desenvolvimento local rapido e build web/mobile.

Motivo: o conceito depende de uma matriz de resolucao de acoes, estados persistentes, animacoes sincronizadas, feedback visual e entrada por toque. Phaser cobre essas necessidades sem o peso de uma engine 3D/nativa. HTML/CSS pode continuar sendo usado como referencia de UI, documentacao visual ou overlay, mas a logica do jogo deve ficar separada e testavel.

Outros caminhos possiveis:

- PixiJS: bom se o projeto precisar apenas de renderizacao 2D customizada, mas exige montar mais sistemas ao redor.
- Godot: boa opcao se o objetivo for app nativo/mobile desde cedo, editor visual e pipeline de cenas.
- Unity: viavel, mas provavelmente pesado para este escopo inicial de jogo 2D por turnos.

## Estrutura

- `GDD_Jogo_Luta_Turnos_Completo.pdf`: regras e estrutura principal do jogo.
- `assets/reference/`: imagens de referencia e estudos visuais.
- `assets/background/`: futuras camadas do cenario.
- `assets/ui/`: paineis, botoes, HUD e icones.
- `assets/characters/`: futuros sprites e animacoes dos personagens.
- `prototype/mobile-layout/`: estudo navegavel da tela de batalha mobile.
- `tools/serve-prototype.mjs`: servidor local simples para abrir o prototipo.

## Formato de assets

- Use WebP para imagens ativas no prototipo web: sprites, sequencias de frames, cenario, paineis e botoes, incluindo assets com transparencia.
- Mantenha PNG apenas como fonte, referencia ou backup em pastas `old/` quando for necessario preservar o asset original.
- Antes de adicionar uma animacao por frames, confira o peso total da pasta. O idle atual do ninja usa 45 frames WebP em `assets/characters/ninja-idle/`.

## Prototipo atual

- O jogador controla o personagem da esquerda.
- O personagem da direita escolhe acoes automaticamente.
- Cada turno dura 10 segundos.
- Ao final do tempo, as acoes escolhidas sao resolvidas e o dano reduz a vida de 100%.
- Super exige 3 segmentos de barra.
- Ao terminar a luta, aparece um botao para reiniciar.

## Como rodar o prototipo atual

Requisito: Node.js 18 ou superior.

No terminal, dentro da pasta do projeto:

```bash
npm run prototype
```

Depois acesse:

```text
http://127.0.0.1:4173
```

Tambem e possivel abrir diretamente o arquivo:

```text
prototype/mobile-layout/index.html
```

## Proximos passos recomendados

1. Criar a base Phaser 3 + TypeScript + Vite.
2. Extrair a matriz de resolucao do GDD para dados testaveis.
3. Implementar um loop minimo: escolher acoes, revelar, resolver, aplicar dano/estado e avancar turno.
4. Substituir placeholders por sprites e animacoes simples.
5. Manter o layout mobile 9:16 como alvo principal.
