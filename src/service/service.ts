import AedesService from "./aedesService.ts";
import DeviceService from "./deviceService.ts";
import MqttService from "./mqttService.ts";

class Service {
  deviceService: DeviceService | null = null;
  mqttService: MqttService | null = null;
  aedesService: AedesService | null = null;
}

const service = new Service();
export default service;
