import { md5 } from "../utils.ts";
import service from "./service.ts";
import { Logger } from "../logger.ts";

const logger = Logger.create("DeviceService");

enum DeviceType {
  SWITCH,
}

interface Device {
  id: string; // => `{guid}-{index}`

  guid: string;
  name?: string;
  type: DeviceType;
  index: number;
  macAddress: string;
  roomName?: string;
  gatewayId: string;
}

class DeviceService {
  devices: Record<string, Device> = {};

  // deno-lint-ignore no-explicit-any
  static fromAfterLoginResp(data: any): DeviceService {
    const deviceInfo: Record<
      string,
      {
        gateway?: string;
        macAddress?: string;
      }
    > = {};

    // get gateway info from profile_device
    for (const profileDevice of data.profile.profile_device) {
      if (!profileDevice.device || !profileDevice.gateway) {
        logger.warn("Invalid profile device data:", profileDevice);
        continue;
      }

      deviceInfo[profileDevice.device] = {
        gateway: profileDevice.gateway,
      };
    }

    // get mac address from device
    // deno-lint-ignore no-explicit-any
    for (const deviceData of Object.values(data.device) as any[]) {
      if (!deviceData.name || !deviceData.mac_address) {
        logger.warn("Invalid device data:", deviceData);
        continue;
      }

      if (
        !deviceInfo[deviceData.name] ||
        !deviceInfo[deviceData.name]?.gateway
      ) {
        logger.warn(`No gateway info for device ${deviceData.name}`);
        continue;
      }

      deviceInfo[deviceData.name].macAddress = deviceData.mac_address;
    }

    const devicesManager = new DeviceService();

    for (const profileSubdevice of data.profile.profile_subdevice) {
      try {
        if (
          !profileSubdevice.device_button_group ||
          !profileSubdevice.device_button_group.startsWith("ONOFF GANG")
        ) {
          logger.warn(
            `Unsupported device button group: ${profileSubdevice.device_button_group}`
          );
          continue;
        }

        const index = Number(
          profileSubdevice.device_button_group.replace("ONOFF GANG", "")
        );
        const id = `${profileSubdevice.device}-${index}`;
        if (devicesManager.devices[id]) {
          logger.warn(`Duplicate device id: ${id}`);
          continue;
        }

        const guid = profileSubdevice.device;
        if (!guid) {
          logger.warn("Invalid profile subdevice data:", profileSubdevice);
          continue;
        }

        let roomName = profileSubdevice.room_name;
        if (roomName) roomName = roomName.replace(/\[\/?en\]/g, "").trim();

        if (
          !deviceInfo[profileSubdevice.device] ||
          !deviceInfo[profileSubdevice.device]?.macAddress ||
          !deviceInfo[profileSubdevice.device]?.gateway
        ) {
          logger.warn(
            `Missing device info for ${profileSubdevice.device}:`,
            deviceInfo[profileSubdevice.device]
          );
          continue;
        }

        devicesManager.devices[id] = {
          id,
          guid,
          name: profileSubdevice.title,
          type: DeviceType.SWITCH,
          index,
          macAddress: deviceInfo[profileSubdevice.device]!.macAddress!,
          roomName,
          gatewayId: deviceInfo[profileSubdevice.device]!.gateway!,
        };
      } catch (_e) {
        logger.warn(
          `Invalid device button group format: ${profileSubdevice.device_button_group}`
        );
        continue;
      }
    }

    logger.info(`Loaded ${Object.keys(devicesManager.devices).length} devices`);
    return devicesManager;
  }

  getByMacAddress(macAddress: string): Device[] {
    return Object.values(this.devices).filter(
      (device) => device.macAddress === macAddress
    );
  }

  async switchDevice(id: string, on: boolean) {
    logger.debug(`Switching device ${id} to ${on ? "ON" : "OFF"}`);

    if (!this.devices[id]) throw new Error(`Device with id ${id} not found`);

    if (this.devices[id].type !== DeviceType.SWITCH)
      throw new Error(`Device with id ${id} is not a switch`);

    const device = this.devices[id];
    const gatewayId = device.gatewayId;
    const macAddress = device.macAddress;
    const guid = device.guid;
    const position = device.index;
    const isOn = on;

    const reversedMac = macAddress.split(":").reverse().join("");
    const onOffStatus = isOn ? position.toString(16) : "0";
    const value = `02${reversedMac}8000${position.toString(
      16
    )}${onOffStatus}00`;

    const data = {
      command: "Control",
      function: "bleHelper.perform",
      params: [
        {
          action: "write",
          guid: guid,
          mac_address: macAddress,
          service_id: "ff80",
          char_id: "ff81",
          value: value,
        },
      ],
      callback: "",
      raw: "",
    };

    const topic = `cmd/${await md5(await md5(gatewayId))}`;
    logger.debug(`Publishing MQTT command to topic: ${topic}`);
    service.mqttService?.publish(topic, data);
  }
}

export default DeviceService;
export { DeviceType };
export type { Device };
