import DeviceService from "./service/deviceService.ts";
import service from "./service/service.ts";
import MqttService from "./service/mqttService.ts";
import AedesService from "./service/aedesService.ts";
import { Logger } from "./logger.ts";

const logger = Logger.create("Main");

if (import.meta.main) {
  const baseUrl = Deno.env.get("BASE_URL");
  const username = Deno.env.get("USERNAME");
  const password = Deno.env.get("PASSWORD");
  const appId = Deno.env.get("APP_ID");

  if (!baseUrl || !username || !password || !appId) {
    logger.error(
      "Missing environment variables: BASE_URL, USERNAME, PASSWORD, APP_ID"
    );
    Deno.exit(1);
  }

  logger.info("Starting application...");
  logger.debug("Configuration:", { baseUrl, username, appId });

  // Login request
  const loginUrl = `https://${baseUrl}/api/method/login`;
  const loginBody = {
    usr: username,
    pwd: password,
  };

  logger.info("Attempting login...");
  const loginResp = await fetch(loginUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(loginBody),
  });

  if (!loginResp.ok) {
    logger.error("Login failed", await loginResp.text());
    Deno.exit(1);
  }

  logger.info("Login successful");

  // Get session cookie
  const setCookie = loginResp.headers.get("set-cookie");
  if (!setCookie) {
    logger.error("No session cookie received");
    Deno.exit(1);
  }
  // Only keep the session part (usually sid or similar)
  const cookie = setCookie.split(",")[0].split(";")[0];
  logger.debug("Session cookie obtained");

  // Get app setting
  logger.info("Fetching app settings...");
  const appSettingUrl = `https://${baseUrl}/api/method/appv6.getAppSetting?appId=${appId}`;
  const appSettingResp = await fetch(appSettingUrl, {
    method: "GET",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
    },
  });

  if (!appSettingResp.ok) {
    logger.error("getAppSetting failed", await appSettingResp.text());
    Deno.exit(1);
  }

  const appSetting = await appSettingResp.json();
  const mqttServer = appSetting.config.mqtt_server;
  const mqttPort = appSetting.config.mqtt_port;
  const mqttKeepalive = appSetting.config.mqtt_keepalive;
  const mqttUsername = appSetting.config.mqtt_username;
  const mqttPassword = appSetting.config.mqtt_password;

  logger.info("Initializing MQTT service...");
  logger.debug("MQTT config:", { mqttServer, mqttPort, mqttKeepalive });
  service.mqttService = new MqttService(mqttServer, mqttPort, {
    keepalive: mqttKeepalive,
    username: mqttUsername,
    password: mqttPassword,
  });

  // Get device profile
  logger.info("Fetching device profile...");
  const afterLoginUrl = `https://${baseUrl}/api/method/appv6.afterLogin`;
  const afterLoginResp = await fetch(afterLoginUrl, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      deviceId: "",
      appId: appId,
      user_setting_name: `${appId}-${username}`,
    }),
  });

  if (!afterLoginResp.ok) {
    logger.error("afterLogin failed", await afterLoginResp.text());
    Deno.exit(1);
  }

  const resp = await afterLoginResp.json();
  service.deviceService = DeviceService.fromAfterLoginResp(resp);

  const deviceCount = Object.keys(service.deviceService.devices).length;
  logger.info(
    `Application initialized successfully with ${deviceCount} devices`
  );

  const aedesPort = Number(Deno.env.get("AEDES_PORT") || 1883);
  const homebridgeMqttTopicPrefix =
    Deno.env.get("HOMEBRIDGE_MQTT_TOPIC_PREFIX") || "homebridge";
  service.aedesService = new AedesService(aedesPort, {
    homebridgeMqtt: {
      topicPrefix: homebridgeMqttTopicPrefix,
    },
  });
  service.aedesService.start();
}
