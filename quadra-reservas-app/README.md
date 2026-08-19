# Quadra Reservas

Sistema web de administração de horários da quadra do condomínio: reservas
avulsas e horários fixos trimestrais, com um sorteio justo e auditável para
substituir o "quem chega primeiro na portaria".

## As regras implementadas

1. **Bloco de 1 hora cheia.** Nada de horário quebrado (ex: 11h30, meio-dia e
   meia) — só é possível reservar horas cheias dentro do funcionamento da
   quadra (configurável, padrão 7h–22h).
2. **Limite semanal por morador.** Cada morador pode ter no máximo N reservas
   por semana (padrão: 2), somando reservas fixas e avulsas.
3. **Horário fixo trimestral.** A cada trimestre (padrão: 3 meses,
   configurável), o morador pode manifestar interesse em fixar até N horários
   por semana (mesmo limite acima) para o trimestre seguinte, durante uma
   janela de datas definida pelo síndico.
4. **Sorteio justo quando há disputa.** Se só um morador quis um horário, ele
   é concedido direto. Se dois ou mais moradores quiserem o **mesmo** dia da
   semana + hora, é feito um sorteio aleatório (`crypto.randomInt`, não
   `Math.random`) entre eles — critério igual pra todo mundo, sem vantagem
   pra quem chega primeiro na portaria.
5. **Regra de rodízio contra monopólio.** Se o morador que já tinha aquele
   horário fixo no trimestre anterior (o "titular") quiser renová-lo e **há
   outro morador interessado no mesmo horário**, o titular é excluído da
   disputa por aquele horário específico — ele não concorre de novo
   automaticamente. Ele continua concorrendo normalmente aos outros horários
   que pedir, e pode reservar aquele horário como avulso quando estiver
   livre. Se ninguém mais quiser o horário, o titular continua com ele
   normalmente (sem disputa, sem sorteio).
6. **Auditoria pública do sorteio.** Toda disputa fica registrada: quem
   concorreu, se o titular foi excluído e por quê, e o número sorteado. Essa
   auditoria é visível pra qualquer morador em "Sorteios" — não é uma caixa
   preta do síndico.

## Como o fluxo funciona

```
                     trimestre atual em andamento
                                 │
          janela de interesse do PRÓXIMO trimestre abre
     (dias antes definidos em Configurações, padrão: 20 dias antes)
                                 │
      moradores pedem até N horários (dia da semana + hora) no app
                                 │
                   janela de interesse fecha
                    (padrão: 7 dias antes do início)
                                 │
        síndico clica em "Rodar sorteio" (Admin > Trimestres)
   → único interessado = concedido direto
   → disputa = titular anterior excluído se houver outro interessado,
     sorteio aleatório entre os elegíveis, tudo fica em log público
                                 │
     reservas da quadra são geradas automaticamente pra cada semana
              do trimestre, no horário sorteado
```

Reservas **avulsas** (não fixas) continuam disponíveis o tempo todo pelo app,
dentro de um horizonte de antecedência configurável (padrão: 14 dias) e
respeitando o limite semanal — como todo mundo reserva pelo mesmo app, no
mesmo instante, não existe mais vantagem de quem está fisicamente na
portaria.

## Rodando localmente

Pré-requisitos: Node.js 18+.

```sh
cd quadra-reservas-app
npm install
cp .env.example .env        # ajuste SESSION_SECRET e a senha do síndico
npm run seed                 # cria a conta do síndico (e, se SEED_DEMO=true, moradores de exemplo)
npm start                    # http://localhost:3000
```

O `npm run seed` imprime o e-mail e a senha inicial do síndico no terminal
(ou usa `ADMIN_EMAIL`/`ADMIN_PASSWORD` do `.env`, se definidos). Troque a
senha em "Perfil" após o primeiro login.

Banco de dados: SQLite, um único arquivo em `data/quadra.db` — não precisa
instalar nem configurar nenhum banco separado. Para resetar tudo, apague os
arquivos `data/quadra.db*` e rode `npm run seed` de novo.

## Uso pelo síndico (Administração)

- **Moradores** — cadastra/desativa contas (só o síndico cria contas; os
  moradores não se autocadastram, pra manter a lista vinculada aos
  apartamentos reais do condomínio).
- **Trimestres & sorteio** — cria o próximo trimestre (datas sugeridas
  automaticamente a partir do trimestre anterior e das configurações) e roda
  o sorteio quando a janela de interesse fechar.
- **Configurações** — horário de funcionamento da quadra, limite semanal,
  antecedência máxima pra reserva avulsa, duração do trimestre e quando a
  janela de interesse abre/fecha.
- **Reservas** — visão geral de tudo que está agendado, com cancelamento
  administrativo (por exemplo, em caso de manutenção da quadra).

Também é possível cadastrar mais de uma quadra (Administração → Quadras) se o
condomínio tiver mais de um espaço esportivo — o limite semanal por morador
soma as reservas em todas as quadras.

## Uso pelo morador

- **Início** — grade da semana, clique num horário livre pra reservar
  (avulso).
- **Minhas reservas** — próximas reservas (fixas e avulsas) e cancelamento.
- **Horário fixo** — enquanto a janela do próximo trimestre estiver aberta,
  escolha até N combinações de dia da semana + hora.
- **Sorteios** — resultado e auditoria completa de cada trimestre já
  sorteado.

## Testes

```sh
npm test
```

Os testes (`node --test`, sem dependências extras) cobrem principalmente as
regras de negócio mais sensíveis:

- horário inválido/quebrado é rejeitado;
- limite semanal por morador é respeitado (e não vaza entre moradores);
- cancelamento libera o horário e só o dono (ou o síndico) pode cancelar;
- **o sorteio exclui corretamente o titular anterior quando há outro
  interessado no mesmo horário**, mantendo-o elegível nos demais horários
  que pediu;
- horário com um único interessado é concedido direto, sem sorteio;
- as reservas fixas são materializadas em todas as ocorrências semanais do
  trimestre;
- notificações corretas são enviadas ao vencedor e aos demais candidatos.

## Arquitetura

- **Backend:** Node.js + Express, renderização server-side com EJS (sem
  build step / bundler — fácil de rodar em qualquer servidor simples).
- **Banco:** SQLite via `better-sqlite3` (síncrono, single-file, zero
  configuração — e, como é síncrono, evita condições de corrida em disputas
  por horário sem precisar de locks manuais).
- **Sessão:** cookie de sessão via `express-session` (armazenamento em
  memória por padrão — para produção com múltiplas instâncias, troque por um
  `session store` compartilhado, ex. Redis).
- **Estrutura:**
  - `src/db.js` — schema do banco e configurações padrão.
  - `src/services/` — toda a lógica de negócio (reservas, trimestres,
    sorteio, usuários, notificações), sem depender do Express — testável
    isoladamente.
  - `src/routes/` — rotas HTTP, finas, delegando pros services.
  - `views/` — templates EJS.
  - `test/` — testes das regras de negócio.

## Limitações conhecidas / próximos passos possíveis

- Notificações são só dentro do app (sem e-mail/SMS/WhatsApp) — dá pra
  integrar um provedor de e-mail depois sem mudar o modelo de dados.
- O sorteio uniforme entre elegíveis não pondera por "há quanto tempo o
  morador não tem horário fixo nenhum" — hoje é 100% aleatório entre quem
  não foi excluído. Se o condomínio quiser favorecer ainda mais o rodízio
  entre muitos moradores diferentes, dá pra trocar o sorteio uniforme por um
  sorteio ponderado usando o histórico em `fixed_allocations`.
- Sessão em memória: reiniciar o processo derruba os logins ativos. Para
  produção contínua, considere um `session store` persistente.
