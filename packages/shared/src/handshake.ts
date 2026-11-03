export interface HelloMessage {
  type: "raspberrycode-hello";
  version: string;
  platform: string;
  arch: string;
  pid: number;
}

export interface HelloAckMessage {
  type: "raspberrycode-hello-ack";
  version: string;
  clientId: string;
}
