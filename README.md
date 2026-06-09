# Capitaliza · Simuladores de Investimento

Aplicação web com três calculadoras de investimento, organizadas em abas e com
um design único (tema claro e escuro, gráficos em SVG feitos à mão):

1. **Renda Fixa**: simula CDB, LCI, LCA, Tesouro IPCA+ ou Prefixado com juros
   compostos, aplicando as regras tributárias corretas de cada papel.
2. **Juros Compostos**: projeta o crescimento de uma aplicação com aportes ou
   retiradas mensais, em juros compostos ou simples.
3. **Comparador**: coloca dois investimentos lado a lado e mostra qual rende mais
   depois do Imposto de Renda.

> Aplicação educativa. Não é recomendação de investimento.

---

## Descrição e objetivo

A maioria das calculadoras de renda fixa ignora o detalhe que mais muda o
resultado: a **tributação**. Um CDB de 110% do CDI pode render menos, no
líquido, do que uma LCI de 98% do CDI, porque a LCI é isenta de Imposto de
Renda. O objetivo do Capitaliza é deixar isso visível, em três ferramentas que
respondem perguntas diferentes:

- **Renda Fixa**: para um cenário de aportes e prazo, quanto você terá ao final
  (bruto e líquido), quanto investiu e quanto rendeu depois dos impostos.
- **Juros Compostos**: como um valor cresce com aportes, ou por quanto tempo um
  patrimônio sustenta retiradas mensais.
- **Comparador**: entre dois papéis, qual entrega a maior rentabilidade líquida.

---

## Funcionalidades

### Aba Renda Fixa

- **Cinco papéis** com regras próprias: CDB, LCI, LCA, Tesouro IPCA+ e Prefixado.
- **Três indexadores**: pós-fixado (% do CDI), prefixado (% a.a.) e IPCA+ (juro real).
- **Imposto de Renda regressivo** calculado por aporte, conforme o tempo que cada
  depósito ficou aplicado (tabela 22,5% / 20% / 17,5% / 15%).
- **Isenção de IR** automática para LCI e LCA.
- **IOF** dos primeiros 30 dias documentado (zero no horizonte simulado).
- **Cobertura do FGC** e aviso de **carência mínima** conforme as regras do CMN.
- **Gráfico de evolução** mês a mês, com tooltip ao passar o mouse e alternância
  entre valores líquidos e brutos.
- **Rosca de composição** no resgate (investido, juros líquido e imposto).
- **Comparação entre os cinco papéis** lado a lado.
- **Equivalência de taxas** (ex.: "este CDB rende como uma LCI de ~93,5% do CDI").
- **Tabela ano a ano** com investido, juros do ano e saldos bruto e líquido.

### Aba Juros Compostos

- **Juros compostos ou simples**, escolhidos por um seletor.
- **Aportes mensais** ou modo de **retiradas mensais** (saques a partir do valor inicial).
- **Taxa em % ao ano ou ao mês** e **período em anos ou meses**.
- Conversão correta de taxa: equivalente para compostos, proporcional para simples.
- **Detecção de esgotamento**: avisa em que mês o saldo zera nas retiradas.
- Métricas, gráfico de evolução e tabela mês a mês.

### Aba Comparador

- Dois investimentos lado a lado, cada um com tipo, forma de rentabilidade
  (pré-fixado, % do CDI ou IPCA+), taxa e prazo em meses.
- **Rentabilidade líquida** já descontado o IR do prazo, com o veredito de qual
  rende mais e por quantos pontos percentuais ao ano.
- Classificação de prazo (curto, médio, longo) e alíquota de IR ou isenção.

### Comuns a todas

- **Tema claro e escuro** com preferência salva no navegador.
- **Acessibilidade**: abas navegáveis por teclado, rótulos descritivos, regiões
  `aria-live` e respeito a `prefers-reduced-motion`.

---

## Estrutura de arquivos

```
calc/
├── index.html   Estrutura, conteúdo e marcação semântica
├── style.css    Estilos, sistema de temas e responsividade
├── script.js    Lógica financeira, gráficos e interatividade
└── README.md    Este documento
```

Cada camada fica em um único arquivo. O escopo não justifica dividir em módulos
separados, e o arquivo único facilita abrir a página sem servidor (ver abaixo).
Internamente, o `script.js` é organizado em blocos com responsabilidade clara:
`config` (dados dos papéis e tabelas), `format` (formatadores pt-BR),
`finance` (motor de simulação), `charts` (gráfico SVG reutilizável) e, por
funcionalidade, `renda fixa`, `juros compostos`, `comparador` e `abas`, além do
controle de `tema`.

---

## Tecnologias utilizadas

- **HTML5** semântico (`header`, `main`, `section`, `form`, `fieldset`, `table`).
- **CSS3** puro: variáveis para temas, Grid, Flexbox, `:has()`, `color-mix()`,
  `backdrop-filter` e media queries (`prefers-color-scheme`, `prefers-reduced-motion`).
- **JavaScript** moderno, sem dependências: `Intl.NumberFormat` para moeda e
  porcentagem em pt-BR, SVG construído via script para os gráficos,
  `ResizeObserver` para o gráfico responsivo e `localStorage` para o tema.

Sem frameworks, bibliotecas, CDNs ou etapa de build. Tudo roda no navegador.

---

## Como executar

A aplicação não precisa de servidor nem de instalação.

**Opção 1 (mais simples):** dê um duplo clique no `index.html`, ou abra-o no
navegador com `Ctrl+O`. Por usar um script clássico (sem módulos ES), funciona
direto pelo protocolo `file://`.

**Opção 2 (servidor local, opcional):** se preferir servir por HTTP, na pasta do
projeto rode um destes comandos e acesse `http://localhost:8000`:

```bash
python3 -m http.server 8000
# ou
npx serve
```

Navegadores suportados: versões atuais de Chrome, Firefox, Edge e Safari
(o layout usa recursos de CSS recentes, como `:has()` e `color-mix()`).

---

## Como usar

Use as **abas** no topo para alternar entre as três calculadoras.

### Renda Fixa

1. **Escolha o tipo de investimento.** O painel de regras atualiza na hora
   (isenção de IR, FGC, carência).
2. **Escolha o indexador.** As opções mudam conforme o papel. O Tesouro IPCA+ é
   sempre IPCA+; o Prefixado é sempre taxa fixa.
3. **Informe a taxa.** O rótulo se adapta: "% do CDI", "% a.a." ou taxa real.
4. **Preencha valor inicial, aporte mensal e período** (em anos, pelo controle
   deslizante ou digitando).
5. **Leia o resultado** (recalcula automaticamente): métricas no topo, gráfico de
   evolução com tooltip e botão "Líquido / Bruto", bloco "No resgate" com a
   composição e as regras, comparação entre os cinco papéis e a tabela ano a ano.
6. **Ajuste as premissas** em "Taxas de referência" (CDI e IPCA), se quiser.

### Juros Compostos

1. Escolha **Compostos** ou **Simples** e **Aportar** ou **Retirar**.
2. Informe valor inicial, valor mensal, a taxa (ao ano ou ao mês) e o período
   (anos ou meses).
3. Veja o valor final, o total investido (ou retirado), os juros, o gráfico e a
   tabela mês a mês. Em retiradas, um aviso indica se e quando o saldo se esgota.

### Comparador

1. Defina os dois investimentos (tipo, forma de rentabilidade, taxa e prazo).
2. Ajuste o CDI e o IPCA base, se quiser, e clique em **Calcular**.
3. Leia o veredito e os dois cartões com a rentabilidade líquida de cada um.

O **tema** claro/escuro fica no botão do canto superior direito, e vale para
todas as abas.

---

## Validação e testes (roteiro manual)

Abra o `index.html` e confirme cada comportamento:

| Aba | Ação | Resultado esperado |
|---|---|---|
| Renda Fixa | Cenário padrão (CDB, 110% do CDI, R$ 1.000 + R$ 500/mês, 5 anos) | Investido R$ 31.000,00, total líquido perto de R$ 43.796,91, juros líquido R$ 12.796,91 |
| Renda Fixa | Trocar de CDB para LCI | A linha de IR vira "isento" e o valor líquido sobe |
| Renda Fixa | Tesouro IPCA+ com prazo curto (ex.: 2 anos) | Aviso de carência mínima de 36 meses em vermelho |
| Juros Compostos | R$ 1.000 + R$ 100/mês, 14,79% ao ano, 12 anos | Valor final perto de R$ 41.859,40, juros R$ 26.459,40 |
| Juros Compostos | Modo Retirar com retirada maior que os juros | Aviso do mês em que o saldo se esgota |
| Comparador | CDB 108% do CDI x LCA 103% do CDI, 36 meses | CDB 91,80% do CDI líquido, LCA 103%; veredito: LCA rende mais |
| Todas | Deixar campos numéricos em branco | Tudo zera sem erro (sem `NaN`) |
| Todas | Alternar o tema e recarregar a página | A preferência de tema é mantida |

Ferramentas úteis de verificação: **validador W3C** para o HTML e **Lighthouse**
(DevTools) para performance e acessibilidade.

---

## Regras financeiras adotadas

Conferidas em fontes públicas (referência de junho de 2026; taxas e normas
podem mudar):

- **IR regressivo** sobre o rendimento: 22,5% até 180 dias, 20% até 360, 17,5%
  até 720 e 15% acima disso. Calculado por aporte, pois cada depósito tem seu
  próprio tempo de aplicação no resgate.
- **LCI e LCA**: isentas de IR para pessoa física.
- **IOF**: incide apenas em resgates antes de 30 dias (tabela de 96% a 0%). No
  horizonte deste simulador (meses inteiros) é sempre zero.
- **FGC**: garante CDB, LCI e LCA até R$ 250 mil por CPF e por instituição.
  Tesouro Direto não tem FGC (risco soberano).
- **Carência mínima (CMN)**: 6 meses para LCI/LCA não indexadas a preço; 36
  meses para LCI atrelada ao IPCA; 12 meses para LCA atrelada ao IPCA.
- **Padrões editáveis**: Selic 14,50% a.a. (Copom, jun/2026), CDI 14,40%,
  IPCA 4,50%.

Conversão de taxas: o rendimento anual efetivo vira taxa mensal por
`(1 + anual)^(1/12) - 1`, e o IPCA+ usa a fórmula de Fisher,
`(1 + IPCA) × (1 + juro real) - 1`. Nos juros simples, a taxa anual vira mensal
de forma proporcional (`anual / 12`).

Aportes no **fim do mês** (annuity ordinária): o valor inicial rende desde o
primeiro mês e cada aporte só rende a partir do mês seguinte ao depósito. É a
convenção usada pelas calculadoras de juros compostos mais comuns. A alternativa
(aporte no início do mês) renderia `aporte × ((1 + i)^meses - 1)` a mais.

---

## Decisões técnicas principais

- **Vanilla puro, sem dependências.** Atende à restrição do projeto e mantém a
  página leve e sem etapa de build.
- **Script clássico em IIFE** (em vez de módulos ES) para que a página funcione
  abrindo o arquivo direto, sem servidor, e sem poluir o escopo global.
- **Gráficos em SVG construídos por script**, em vez de uma biblioteca de
  charts, dando controle total sobre a estética e zero dependências.
- **Imposto calculado por lote (por aporte)**, mais fiel à realidade do que
  aplicar uma única alíquota sobre o rendimento total.
- **Pilha de fontes do sistema**, sem Google Fonts via `<link>`, para a página
  ser totalmente autossuficiente e funcionar offline.
- **Tema por variáveis CSS** com persistência em `localStorage` e respeito a
  `prefers-color-scheme`.

---

## Boas práticas adotadas

- Separação de responsabilidades em camadas dentro do `script.js`.
- Funções pequenas e coesas; nomes técnicos em inglês, interface em pt-BR.
- Validação das entradas e tratamento de casos de borda (campos vazios, prazo
  fora do limite, divisão por zero na composição).
- HTML semântico e acessível (rótulos, `aria-label`, `aria-live`, foco visível).
- Animação só quando comunica algo (contagem dos números, desenho da curva),
  desligada sob `prefers-reduced-motion`.
- Sem variáveis globais; estado centralizado e recálculo com `debounce`.

---

## Possíveis melhorias futuras

- Comparar cenários salvos lado a lado (dois ou mais conjuntos de parâmetros).
- Considerar a inflação do período para mostrar o ganho real, além do nominal.
- Modelar o "come-cotas" para fundos e a marcação a mercado do Tesouro.
- Exportar o resultado (PDF ou CSV) e gerar um link compartilhável.
- Buscar CDI, Selic e IPCA atuais de uma fonte oficial, mantendo a edição manual.
- Adicionar a poupança e debêntures incentivadas à comparação.
