import {Injectable} from "@nestjs/common";
import {Card} from "../../script/Card";
import {Board, Play, RoomModel, RoundModel, User} from "../../room/room.model";
import {RedisService} from "../../redis/service/redis.service";
import {RoomService} from "../../room/service/room.service";
import cards from "../../script/cards";

@Injectable()
export class GameService {
  constructor(
    private redisService: RedisService,
    private roomService: RoomService,
  ) {
  }

  async getCards(nb: number): Promise<Card[]> {
    return cards(nb);
  }

  async flushCards(nb: number): Promise<Card[]> {
    let fullCards: Card[] = cards(nb);
    fullCards.sort(() => Math.random() - 0.5);
    return fullCards;
  }

  async startGame(slug: string, user: User): Promise<User[]> {
    const room = await this.roomService.getRoom(slug);
    if (room.host.userId != user.userId) throw new Error("Vous n'êtes pas le créateur de la room");
    if (room.currentPlayers < 2) throw new Error("Il n'y a pas assez de joueurs");
    if (room.started == true) throw new Error("La partie à déjà commencé");
    const fullCards: Card[] = await this.flushCards(room.currentPlayers);
    for (const [index, user] of room.users.entries()) {
      user.cards = fullCards.slice(index * 10, (index + 1) * 10);
      user.hasToPlay = true;
      user.cardsLost = [];
    }
    room.board = {
      slot1: {
        cards: [fullCards[fullCards.length - 1]],
      },
      slot2: {
        cards: [fullCards[fullCards.length - 2]]
      },
      slot3: {
        cards: [fullCards[fullCards.length - 3]]
      },
      slot4: {
        cards: [fullCards[fullCards.length - 4]]
      },
    }
    await this.newRound(slug);
    await this.redisService.hset(`room:${slug}`, ['started', 'true', 'users', JSON.stringify(room.users), 'board', JSON.stringify(room.board)]);
    return room.users;
  }

  async newRound(slug: string) {
    const room = await this.roomService.getRoom(slug);
    room.currentRound++;
    for (const [_, user] of room.users.entries()) {
      user.hasToPlay = true;
    }
    await this.redisService.hset(`room:${slug}`, ['currentRound', room.currentRound.toString(), 'users', JSON.stringify(room.users)]);
    await this.redisService.hset(`room:${slug}:${room.currentRound}`, ['cards', JSON.stringify([])]);
  }

  async play(card: Card, user: User, slug: string) {
    const room: RoomModel = await this.roomService.getRoom(slug);
    const round: RoundModel = await this.roomService.getRound(slug, room.currentRound);
    user = room.users.find((elem: User) => elem.userId == user.userId);
    if (!room.started) throw new Error("La partie n'a pas commencé");
    if (!user.hasToPlay) throw new Error("Tu as déjà jouer");
    if (!this.cardInDeck(card, user.cards)) throw new Error("Tu n'as pas cette carte");
    let play: Play = {
      card: card,
      user: user
    }
    await this.redisService.hset(`room:${slug}:${room.currentRound}`, ['cards', JSON.stringify([...round.cards, play])]);
    console.log("AFTER room.users -> ", room.users);
    user.cards = this.removeCardOnDeck(card, user.cards);
    user.hasToPlay = false;
    console.log("AFTER room.users -> ", room.users);
    await this.redisService.hset(`room:${slug}`, ['users', JSON.stringify(room.users)]);
  }

  async playCard(play: Play, slug: string) {
    const room: RoomModel = await this.roomService.getRoom(slug);
    const round: RoundModel = await this.roomService.getRound(slug, room.currentRound);
    let slotIndex = await this.selectSlot(room.board, play.card);
    if (slotIndex > 0) {
      if (await this.checkSlotFull(slotIndex, slug)) {

      } else {
        room.board[`slot${slotIndex}`].cards.push(play.card);
        await this.redisService.hset(`room:${slug}`, ['board', JSON.stringify(room.board)]);
      }
    }
  }

  // a refacto
  async selectSlot(board: Board, card: Card): Promise<number> {
    let slotIndex: number = -1;
    let slotValue: number = 0;
    if (card.value > board.slot1.cards[board.slot1.cards.length - 1].value) {
      slotIndex = 1;
      slotValue = board.slot1.cards[board.slot1.cards.length - 1].value;
    }
    if (card.value > board.slot2.cards[board.slot2.cards.length - 1].value && board.slot2.cards[board.slot2.cards.length - 1].value > slotValue) {
      slotIndex = 2;
      slotValue = board.slot2.cards[board.slot2.cards.length - 1].value;
    }
    if (card.value > board.slot3.cards[board.slot3.cards.length - 1].value && board.slot3.cards[board.slot3.cards.length - 1].value > slotValue) {
      slotIndex = 3;
      slotValue = board.slot3.cards[board.slot3.cards.length - 1].value;
    }
    if (card.value > board.slot4.cards[board.slot4.cards.length - 1].value && board.slot4.cards[board.slot4.cards.length - 1].value > slotValue) {
      slotIndex = 4;
    }
    return slotIndex;
  }

  cardInDeck(card: Card, deck: Card[]): boolean {
    return !!deck.find((elem: Card) => elem.id == card.id);
  }

  removeCardOnDeck(card: Card, deck: Card[]): Card[] {
    return deck.filter((elem: Card) => elem.id != card.id);
  }

  async getDeck(slug: string, user: User): Promise<Card[]> {
    const room: RoomModel = await this.roomService.getRoom(slug);
    return room.users.find((elem: User) => elem.username == user.username).cards;
  }

  async getBoard(slug: string): Promise<Board> {
    const room: RoomModel = await this.roomService.getRoom(slug);
    return room.board;
  }

  async checkEveryonePlayed(slug: string): Promise<boolean> {
    const room: RoomModel = await this.roomService.getRoom(slug);
    return !room.users.find((elem: User) => elem.hasToPlay == true);
  }

  async checkSlotFull(slotIndex: number, slug: string): Promise<boolean> {
    const room: RoomModel = await this.roomService.getRoom(slug);
    return room.board[`slot${slotIndex}`].cards.length == 5;
  }

  async sortCardsPlayed(slug: string): Promise<Play[]> {
    const room: RoomModel = await this.roomService.getRoom(slug);
    const round: RoundModel = await this.roomService.getRound(slug, room.currentRound);
    round.cards.sort((a: Play, b: Play) => a.card.value - b.card.value);
    await this.redisService.hset(`room:${slug}:${room.currentRound}`, ['cards', JSON.stringify(round.cards)]);
    return round.cards;
  }
}

