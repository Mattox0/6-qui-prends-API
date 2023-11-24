import {
  ConnectedSocket, MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from '@nestjs/websockets';
import {Socket} from 'socket.io';
import {RedisService} from "../redis/service/redis.service";
import {RoomService} from "./service/room.service";
import {Message} from "./dto/room.dto";
import {GameService} from "../game/service/game.service";
import {SimpleUser} from "./room.model";


@WebSocketGateway({cors: '*', namespace: 'room'})
export class RoomWebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect {

  constructor(private readonly redisService: RedisService,
              private readonly roomService: RoomService,
              private readonly gameService: GameService) {
  }

  @WebSocketServer() server;

  handleConnection(socket: Socket): void {
    socket.data.user = {
      userId: socket.handshake.query.userId as string,
      socketId: socket.id,
      username: socket.handshake.query.username as string,
    };
    socket.data.slug = socket.handshake.query.slug as string
    console.log(`New connecting... socket id:`, socket.id);
  }

  handleDisconnect(socket: Socket): void {
    // gerer le cas si disconnect pendant une partie
    console.log(`Disconnecting... socket id:`, socket.id);
  }

  @SubscribeMessage('leaveRoom')
  async leaveRoom(@ConnectedSocket() client: Socket) {
    this.server.to(client.data.slug).emit('members', await this.roomService.usersWithoutCardsInRoom(client.data.slug));
  }

  @SubscribeMessage('joinRoom')
  async joinRoom(@ConnectedSocket() client: Socket): Promise<{}> {
    return this.handleAction(client.data.slug, async () => {
      console.log("API joinRoom -> ", client.data.slug, client.data.user)
      await this.roomService.addUserToRoom(client.data.slug, client.data.user)
      client.join(client.data.slug);
      this.server.to(client.data.user.socketId).emit('cards', await this.gameService.getDeck(client.data.slug, client.data.user));
      this.server.to(client.data.slug).emit('members', await this.roomService.usersWithoutCardsInRoom(client.data.slug));
      return {gameIsStarted: await this.roomService.gameIsStarted(client.data.slug)};
    });
  }

  @SubscribeMessage('chat')
  chat(@ConnectedSocket() client: Socket, @MessageBody() message: Message): { message: string } {
    // console.log("API chat message -> ", message);
    this.server.to(client.data.slug).emit('chat', message, client.data.user); // broadcast messages
    return {message: "Message bien envoyé"};
  }

  @SubscribeMessage('startGame')
  async startGame(@ConnectedSocket() client: Socket): Promise<{}> {
    return this.handleAction(client.data.slug, async () => {

    });
  }

  @SubscribeMessage('bet')
  async bet(@ConnectedSocket() client: Socket, @MessageBody() bet: number): Promise<{}> {
    return this.handleAction(client.data.slug, async () => {

    });
  }

  async handleAction(slug: string, callback: Function): Promise<{}> {
    try {
      if (await this.redisService.exists(`room:${slug}`)) {
        return await callback();
      } else {
        throw new Error("La room n'existe pas");
      }
    } catch (e) {
      return {
        error: e.message,
      }
    }
  }
}
