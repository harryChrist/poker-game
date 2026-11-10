import type { GameId } from '@cards/shared';

/**
 * Tutoriais "Como jogar" de cada jogo — escritos de acordo com as regras implementadas nos motores
 * (packages/games). Se mudar uma regra lá, atualize aqui.
 */
export interface TutorialSection {
  title: string;
  items: string[];
}

export interface Tutorial {
  /** Uma frase sobre o jogo */
  intro: string;
  sections: TutorialSection[];
}

export const GENERAL_TUTORIAL: TutorialSection[] = [
  {
    title: 'Fichas',
    items: [
      'As fichas são virtuais, não é dinheiro de verdade. Todo mundo começa com 10.000.',
      'A cada hora dá para pegar um bônus de +1.000 no lobby. Ficou quase sem fichas? Use a Recarga.',
      'Poker e Blackjack: você senta com uma entrada (buy-in) e, ao levantar, leva o que sobrou.',
      'Nos outros jogos cada um paga a aposta da sala no início e quem vence leva o pote.',
    ],
  },
  {
    title: 'Salas',
    items: [
      'Crie uma sala escolhendo o jogo e as regras (aposta, tempo por jogada, número de jogadores). Salas privadas só abrem com o código de 6 letras.',
      'Quem cria é o líder: adiciona bots, remove pessoas e começa o jogo.',
      'Cada jogador sentado marca "Estou pronto". Com metade ou mais pronta, o jogo começa sozinho em 30 s (quem não ficou pronto sai do lugar).',
      'Tempo por jogada: se acabar, o jogo joga por você ou te tira da mesa (conforme a sala). Em "Sem limite" cada um joga no seu tempo.',
      'Botões no topo da sala: 👁 esconde a sua mão (passe o mouse para espiar), 🕘 histórico do que aconteceu na mesa e 💬 chat.',
    ],
  },
];

export const TUTORIALS: Record<GameId, Tutorial> = {
  poker: {
    intro: "Texas Hold'em sem limite: monte a melhor mão de 5 cartas com as suas 2 e as 5 da mesa, ou faça todo mundo desistir.",
    sections: [
      {
        title: 'Como uma mão funciona',
        items: [
          'Cada jogador recebe 2 cartas fechadas. Os dois à esquerda do botão (D) pagam o small blind (SB) e o big blind (BB).',
          'Rodadas de apostas: pré-flop, flop (3 cartas na mesa), turn (4ª carta) e river (5ª carta).',
          'Na sua vez: Desistir, Check (passar, se ninguém apostou), Pagar (igualar a aposta), Apostar/Aumentar ou All-in.',
          'O aumento mínimo é o tamanho do último aumento (no mínimo o big blind). Use ½ pote, Pote, All-in ou o controle deslizante.',
          'Se todo mundo desistir, quem sobrou leva o pote sem mostrar as cartas. Senão, no showdown vence a melhor mão.',
        ],
      },
      {
        title: 'Ranking das mãos (da maior para a menor)',
        items: [
          'Royal Flush: A-K-Q-J-10 do mesmo naipe.',
          'Straight Flush: 5 cartas em sequência do mesmo naipe.',
          'Quadra: 4 cartas do mesmo valor.',
          'Full House: uma trinca + um par.',
          'Flush: 5 cartas do mesmo naipe.',
          'Sequência: 5 cartas seguidas (A-2-3-4-5 também vale).',
          'Trinca, Dois Pares, Par e, por último, Carta Alta.',
        ],
      },
      {
        title: 'Bom saber',
        items: [
          'Quem fica all-in disputa só o que conseguiu cobrir; o resto vira pote lateral.',
          'Você pode levantar a qualquer momento e leva as fichas que tem na frente. Ficou sem fichas? "+ Fichas" para recomprar.',
        ],
      },
    ],
  },
  blackjack: {
    intro: 'Contra a banca: chegue mais perto de 21 do que ela, sem passar de 21.',
    sections: [
      {
        title: 'Valor das cartas',
        items: [
          '2 a 10 valem o número. J, Q e K valem 10.',
          'O Ás vale 11 ou 1, o que for melhor ("soft" quando ele está valendo 11).',
          'Blackjack = Ás + carta de valor 10 nas duas primeiras cartas. Paga 3 para 2.',
        ],
      },
      {
        title: 'Como uma rodada funciona',
        items: [
          'Todos apostam ao mesmo tempo (entre a aposta mínima e a máxima da mesa) ou pulam a rodada.',
          'Cada um recebe 2 cartas abertas. A banca fica com uma aberta e uma virada.',
          'Na sua vez: Pedir (mais uma carta), Parar, Dobrar (só com 2 cartas: dobra a aposta e recebe exatamente mais 1 carta) ou Dividir (2 cartas do mesmo valor viram 2 mãos, até 4 mãos; Ases divididos recebem só 1 carta cada).',
          'Se a banca mostra um Ás, dá para fazer Seguro (metade da aposta): paga 2 para 1 se ela tiver blackjack.',
          'Depois a banca revela e compra até ter 17 ou mais (ela para em todo 17).',
        ],
      },
      {
        title: 'Resultado',
        items: [
          'Passou de 21: perdeu (mesmo que a banca estoure depois).',
          'Maior que a banca, ou banca estourou: ganha o valor da aposta. Empate devolve a aposta.',
          'A mesa usa um sapato com vários baralhos, embaralhado quando restam menos de 25% das cartas.',
        ],
      },
    ],
  },
  truco: {
    intro: 'Truco Paulista com vira e manilha, em 1x1 ou duplas. Quem fizer 12 pontos primeiro vence.',
    sections: [
      {
        title: 'Cartas e força',
        items: [
          'Baralho de 40 cartas (sem 8, 9 e 10). Cada um recebe 3 cartas.',
          'Ordem, da mais fraca para a mais forte: 4, 5, 6, 7, Q, J, K, A, 2, 3.',
          'Depois de dar as cartas vira-se uma carta (a vira). A manilha é a carta seguinte a ela (vira 7 → manilha Q; vira 3 → manilha 4).',
          'As 4 manilhas ganham de tudo. Entre elas: ouros < espadas < copas < paus (o zap, a mais forte).',
        ],
      },
      {
        title: 'A mão',
        items: [
          'Cada mão é uma melhor de 3 vazas: cada um joga uma carta e a mais forte leva a vaza.',
          'Empate na 1ª vaza ("cangou"): ganha quem vencer a 2ª. Empate depois da 1ª: vence quem levou a 1ª. Três empates: ninguém marca.',
          'Em duplas, se você e o parceiro empatam a carta mais alta, a vaza é da dupla.',
          'Da 2ª vaza em diante dá para jogar uma carta encoberta (virada): ela não vale nada, mas esconde o jogo.',
        ],
      },
      {
        title: 'Pedir truco',
        items: [
          'A mão vale 1 ponto. Na sua vez você pode pedir TRUCO (vale 3).',
          'O adversário escolhe: Aceitar, Correr (você marca o valor de antes) ou Aumentar: SEIS (6), NOVE (9), DOZE (12).',
          'Só quem não fez o último pedido pode aumentar.',
        ],
      },
      {
        title: 'Mão de onze e mão de ferro',
        items: [
          'Mão de onze: a dupla com 11 pontos vê as cartas do parceiro e decide jogar (a mão vale 3) ou correr (o adversário marca 1). Não se pede truco.',
          'Mão de ferro (11 a 11): todos jogam sem ver as próprias cartas, sem truco.',
        ],
      },
    ],
  },
  bisca: {
    intro: 'Bisca de 3 cartas com trunfo, em 1x1 ou duplas. Faça mais de 60 dos 120 pontos.',
    sections: [
      {
        title: 'Cartas e pontos',
        items: [
          'Baralho de 40 cartas (sem 8, 9 e 10).',
          'Pontos: Ás 11, 7 10, Rei 4, Valete 3, Dama 2. As outras não valem pontos (total: 120).',
          'Força: A > 7 > K > J > Q > 6 > 5 > 4 > 3 > 2.',
        ],
      },
      {
        title: 'Como jogar',
        items: [
          'Cada um recebe 3 cartas. A carta seguinte é virada: o naipe dela é o trunfo, e ela fica embaixo do monte (é a última a ser comprada).',
          'Não é obrigatório seguir o naipe. Leva a vaza o maior trunfo jogado; sem trunfo, a maior carta do naipe que saiu.',
          'Quem leva a vaza compra primeiro (depois os outros, em ordem) e começa a próxima. Quando o monte acaba, joga-se até acabar as mãos.',
          'Quem tem o 2 do naipe do trunfo pode trocá-lo pela carta virada, na sua vez, enquanto houver pelo menos 2 cartas no monte.',
        ],
      },
      {
        title: 'Quem vence',
        items: [
          'Mais de 60 pontos vence o jogo. 60 a 60 é empate e o jogo é repetido.',
          'A sala define quantos jogos fecham a partida (1 jogo ou melhor de 3/5). Em duplas, os pontos são da dupla.',
        ],
      },
    ],
  },
  sueca: {
    intro: 'Duplas, 40 cartas e trunfo. Junte mais de 60 pontos por mão para ganhar jogos.',
    sections: [
      {
        title: 'Cartas',
        items: [
          '4 jogadores em duplas (quem está à sua frente é o parceiro). Cada um recebe 10 cartas.',
          'Pontos: Ás 11, 7 10, Rei 4, Valete 3, Dama 2 (total 120). Força: A > 7 > K > J > Q > 6 > 5 > 4 > 3 > 2.',
          'O trunfo é a última carta dada ao distribuidor: fica à vista de todos até ele jogá-la.',
        ],
      },
      {
        title: 'Como jogar',
        items: [
          'É obrigatório seguir o naipe que saiu, se você tiver.',
          'Leva a vaza o maior trunfo; sem trunfo, a maior do naipe que saiu. Quem leva começa a próxima.',
        ],
      },
      {
        title: 'Pontuação',
        items: [
          '61 a 90 pontos: a dupla ganha 1 jogo. 91 a 119: 2 jogos. Todas as 120: 4 jogos.',
          '60 a 60: ninguém marca.',
          'Vence a dupla que chegar primeiro ao número de jogos da sala.',
        ],
      },
    ],
  },
  copas: {
    intro: 'Fuja das copas e da dama de espadas. No fim, vence quem tiver MENOS pontos.',
    sections: [
      {
        title: 'Começo da mão',
        items: [
          '4 jogadores, 52 cartas, 13 para cada.',
          'Antes de jogar, cada um escolhe 3 cartas para passar: para a esquerda, depois para a direita, depois para a frente e, na 4ª mão, ninguém passa (e repete).',
          'Quem tem o 2 de paus começa a primeira vaza com ele.',
        ],
      },
      {
        title: 'Regras das vazas',
        items: [
          'É obrigatório seguir o naipe que saiu. Leva a vaza a maior carta desse naipe.',
          'Na primeira vaza não pode jogar copas nem a dama de espadas (a não ser que só tenha isso).',
          'Não pode começar uma vaza com copas até alguém "quebrar copas" (descartar uma copa), a não ser que só tenha copas.',
        ],
      },
      {
        title: 'Pontos',
        items: [
          'Cada copa que você pegar vale 1 ponto. A dama de espadas vale 13.',
          'Fechar o jogo: se você pegar todas as 26, fica com 0 e cada adversário ganha 26.',
          'O jogo termina quando alguém chega ao limite da sala (ex.: 100). Vence a menor pontuação.',
        ],
      },
    ],
  },
  fodinha: {
    intro: 'Aposte quantas vazas vai fazer. Errou para mais ou para menos, perde vida.',
    sections: [
      {
        title: 'Cartas',
        items: [
          'Baralho de 40 cartas com a mesma força do truco: 4 < 5 < 6 < 7 < Q < J < K < A < 2 < 3.',
          'Vira-se uma carta a cada rodada; a manilha é a seguinte a ela (ouros < espadas < copas < paus).',
        ],
      },
      {
        title: 'Rodadas',
        items: [
          'Na 1ª rodada cada um recebe 1 carta, na 2ª 2 cartas, e assim por diante até o máximo, depois volta a diminuir.',
          'Antes de jogar, cada um diz quantas vazas vai fazer (palpite). O último a falar (o "pé") não pode deixar a soma dos palpites igual ao número de cartas.',
          'Na rodada de 1 carta você vê a carta de todo mundo, menos a sua!',
        ],
      },
      {
        title: 'Vazas e vidas',
        items: [
          'Leva a vaza a carta mais forte. Cartas iguais (que não são manilha) se anulam ("embuchou"); se todas se anulam, ninguém leva.',
          'No fim da rodada, você perde 1 vida para cada vaza de diferença entre o palpite e o que fez.',
          'Sem vidas, está fora. Vence o último que sobrar.',
        ],
      },
    ],
  },
  cacheta: {
    intro: 'Forme trincas e sequências com a ajuda do coringa e bata primeiro.',
    sections: [
      {
        title: 'Cartas e coringa',
        items: [
          'Dois baralhos sem 8, 9 e 10 (80 cartas). Cada um recebe 9 cartas.',
          'Vira-se uma carta (a vira). O coringa é o valor seguinte a ela, de qualquer naipe (vira K → coringa A). O coringa substitui qualquer carta.',
        ],
      },
      {
        title: 'Jogos válidos',
        items: [
          'Trinca: 3 ou 4 cartas do mesmo valor, todas de naipes diferentes.',
          'Sequência: 3 ou mais cartas seguidas do mesmo naipe. Ordem: A-2-3-4-5-6-7-J-Q-K (o J vem logo depois do 7), e o Ás também vale depois do K (Q-K-A).',
        ],
      },
      {
        title: 'Na sua vez',
        items: [
          'Compre 1 carta (do monte ou a de cima do descarte) e depois descarte 1.',
          'Bater: com as 9 cartas restantes todas em jogos (descartando a 10ª), ou as 10 em jogos. Use "Organizar" para agrupar a mão e o botão BATER quando ele acender.',
          'Quem bate vence a rodada; todos os outros perdem 1 vida. Sem vidas, está fora. Vence o último que sobrar.',
        ],
      },
    ],
  },
  pife: {
    intro: 'Forme jogos com as suas 9 cartas e bata antes dos outros.',
    sections: [
      {
        title: 'Cartas',
        items: [
          'Baralho de 52 cartas (dois baralhos com 5 ou 6 jogadores). Cada um recebe 9 cartas. Não há coringa.',
        ],
      },
      {
        title: 'Jogos válidos',
        items: [
          'Trinca: 3 ou 4 cartas do mesmo valor, de naipes diferentes.',
          'Sequência: 3 ou mais cartas seguidas do mesmo naipe (A-2-3 ou Q-K-A valem; K-A-2 não).',
        ],
      },
      {
        title: 'Na sua vez',
        items: [
          'Compre 1 carta (do monte ou do descarte) e descarte 1.',
          'Bater: depois de comprar, descarte 1 e deixe as 9 cartas restantes todas em jogos (ex.: 3 trincas/sequências de 3, ou uma de 4 e outra de 5).',
          'Quem bate ganha a rodada. A partida acaba quando alguém chega ao número de vitórias da sala.',
          'Se o monte acabar duas vezes sem ninguém bater, a rodada é anulada e as cartas são dadas de novo.',
        ],
      },
    ],
  },
};
