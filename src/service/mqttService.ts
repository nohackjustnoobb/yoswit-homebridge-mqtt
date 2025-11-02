import mqtt from "mqtt";
import { nanoid } from "@sitnik/nanoid";
import { md5 } from "../utils.ts";
import { Logger } from "../logger.ts";

const logger = Logger.create("MqttService");

interface PublishData {
  user_id?: string;
  from?: string;
  [key: string]: unknown;
}

class MqttService {
  client: mqtt.MqttClient;

  constructor(
    host: string,
    port: number,
    option: {
      keepalive: number;
      username: string;
      password: string;
    }
  ) {
    const clientId = "mobmob-" + nanoid(21);
    logger.info(`Connecting to MQTT broker at ${host}:${port}`);
    logger.debug(`MQTT Client ID: ${clientId}`);

    this.client = mqtt.connect(`mqtt://${host}:${port}`, {
      ...option,
      clientId,
    });

    this.client.on("connect", () => {
      logger.info("Connected to MQTT broker");
    });

    this.client.on("error", (error) => {
      logger.error("MQTT connection error:", error);
    });

    this.client.on("close", () => {
      logger.warn("MQTT connection closed");
    });

    this.client.on("reconnect", () => {
      logger.info("Reconnecting to MQTT broker...");
    });
  }

  async publish(topic: string, data: PublishData) {
    const id = nanoid(21);

    if (!data.user_id) data.user_id = "";
    if (!data.from) data.from = "";

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    data.date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
      now.getDate()
    )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(
      now.getSeconds()
    )}`;

    const checksumStr =
      id + JSON.stringify(data) + data.date + data.user_id + data.from;
    const checksum = await md5(checksumStr);

    const payload = {
      id,
      data,
      checksum,
    };

    logger.debug(`Publishing to topic ${topic}`);
    logger.debug("Payload:", payload);

    this.client.publish(
      topic,
      JSON.stringify(payload),
      {
        qos: 0,
        retain: false,
      },
      (error) => {
        if (error) {
          logger.error(`Failed to publish to ${topic}:`, error);
        } else {
          logger.debug(`Successfully published to ${topic}`);
        }
      }
    );
  }
}

export default MqttService;
