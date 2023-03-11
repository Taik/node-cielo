const querystring = require('querystring');
const fetch = require('node-fetch');
const WebSocket = require('ws');

// Constants
const API_HOST = 'api.smartcielo.com';
const API_HTTP_PROTOCOL = 'https://';
const PING_INTERVAL = 5 * 60 * 1000;
const DEFAULT_POWER = 'off';
const DEFAULT_MODE = 'auto';
const DEFAULT_FAN = 'auto';
const DEFAULT_TEMPERATURE = 75;

// Exports
class CieloAPIConnection {
  // Connection information
  #sessionID;
  #userID;
  #accessToken;
  #agent;
  #commandCount = 0;

  /**
   * WebSocket connection to API
   *
   * @type WebSocket
   */
  #ws;

  /**
   * An array containing all subscribed HVACs
   *
   * @type CieloHVAC[]
   */
  hvacs = [];

  // Callbacks
  #commandCallback;
  #temperatureCallback;
  #errorCallback;

  /**
   * Creates an API connection object that will use the provided callbacks
   * once created.
   *
   * @param {function} commandCallback Callback that executes whenever a
   *      command is sent
   * @param {function} temperatureCallback Callback that executes whenever a
   *      temperature update is received
   * @param {function} errorCallback Callback that executes whenever an error
   *      is encountered
   */
  constructor(commandCallback, temperatureCallback, errorCallback) {
    this.#commandCallback = commandCallback;
    this.#temperatureCallback = temperatureCallback;
    this.#errorCallback = errorCallback;
  }

  // Connection methods
  /**
   * Creates the hvacs array using the provided macAddresses and establishes
   * the WebSockets connection to the API to receive updates.
   *
   * @param {string[]} macAddresses MAC addresses of desired HVACs
   * @returns {Promise<void>} A Promise containing nothing if resolved, error
   *      if an error occurs establishing the WebSocket connection
   */
  async subscribeToHVACs(macAddresses) {
    // Clear the array of any previously subscribed HVACs
    this.hvacs = [];
    this.#commandCount = 0;

    // console.log("accessToken:", this.#accessToken);

    // Get the initial information on all devices
    const deviceInfo = await this.#getDeviceInfo();

    // Ensure the request was successful
    if (deviceInfo.error) return Promise.reject(deviceInfo.error);

    // Extract the relevant HVACs from the results
    for (const device of deviceInfo.data.listDevices) {
      if (macAddresses.includes(device.macAddress)) {
        let hvac = new CieloHVAC(
          device.macAddress,
          device.deviceName,
          device.applianceId,
          device.fwVersion,
        );
        hvac.updateState(
          device.latestAction.power,
          device.latestAction.temp,
          device.latestAction.mode,
          device.latestAction.fanspeed,
        );
        hvac.updateRoomTemperature(device.latEnv.temp);
        this.hvacs.push(hvac);
      }
    }

    // Establish the WebSocket connection
    return this.#connect();
  }

  /**
   * Obtains authentication and socket connection information from the API.
   *
   * @param {string} username The username to login with
   * @param {string} password The password for the provided username
   * @param {string} ip The public IP address of the network the HVACs are on
   * @param {string} agent Optional parameter specifying the agent type to
   *      identify as during the request
   * @returns {Promise<void>} A Promise containing nothing if resolved, and
   *      an error if one occurs during authentication
   */
  async establishConnection(username, password, ip, agent) {
    // TODO: Add ability to recognize authentication failure
    await this.#getAccessTokenAndSessionId(username, password, ip).then(
      (data) => {
        // console.log(data);
        // Save the results
        this.#sessionID = data.sessionId;
        this.#userID = data.userId;
        this.#accessToken = data.accessToken;
        return;
      },
    );
    return Promise.resolve();
  }

  /**
   *
   * @returns
   */
  async #connect() {
    // Establish the WebSockets connection
    const connectUrl = new URL(
      'wss://apiwss.smartcielo.com/websocket/' +
        '?sessionId=' +
        this.#sessionID +
        '&token=' +
        this.#accessToken,
    );
    const connectPayload = {
      sessionId: this.#agent,
      token: this.#accessToken,
    };
    this.#ws = new WebSocket(connectUrl, connectPayload);

    // Start the socket when opened
    this.#ws.on('open', () => {
      this.#startSocket();
    });

    // Provide notification to the error callback when the connection is
    // closed
    this.#ws.on('close', () => {
      this.#errorCallback(new Error('Connection Closed.'));
    });

    // Subscribe to status updates
    this.#ws.on('message', (message) => {
      const data = JSON.parse(message);
      if (
        data.message_type &&
        typeof data.message_type === 'string' &&
        data.message_type.length > 0 &&
        data.action &&
        typeof data.action === 'object'
      ) {
        const type = data.mid;
        const status = data.action;
        const roomTemp = data.lat_env_var.temperature;
        const thisMac = data.mac_address;
        switch (type) {
          case 'WEB':
            this.hvacs.forEach((hvac, index) => {
              if (hvac.getMacAddress() === thisMac) {
                this.hvacs[index].updateState(
                  status.power,
                  status.temp,
                  status.mode,
                  status.fanspeed,
                );
              }
            });
            if (this.#commandCallback !== undefined) {
              this.#commandCallback(status);
            }
            break;
          case 'Heartbeat':
            this.hvacs.forEach((hvac, index) => {
              if (hvac.getMacAddress() === thisMac) {
                this.hvacs[index].updateRoomTemperature(roomTemp);
              }
            });
            if (this.#temperatureCallback !== undefined) {
              this.#temperatureCallback(roomTemp);
            }
            break;
        }
      }
    });

    // Provide notification to the error callback when an error occurs
    this.#ws.on('error', (err) => {
      this.#errorCallback(err);
    });

    // Return a promise to notify the user when the socket is open
    return new Promise((resolve) => {
      this.#ws.on('open', () => {
        resolve();
      });
    });
  }

  // API Calls
  /**
   * Extracts the appUser and sessionID values from the hidden HTML inputs on
   * the index page.
   *
   * @returns {Promise<string[]>} An array containing the appUser and
   *      sessionID
   */
  async #getAccessTokenAndSessionId(username, password, ip) {
    const appUserUrl = new URL(API_HTTP_PROTOCOL + API_HOST + '/web/login');
    const appUserPayload = {
      agent: this.#agent,
      method: 'POST',
      headers: {
        authority: 'api.smartcielo.com',
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'content-type': 'application/json; charset=UTF-8',
        origin: 'https://home.cielowigle.com',
        pragma: 'no-cache',
        referer: 'https://home.cielowigle.com/',
        'x-api-key': '7xTAU4y4B34u8DjMsODlEyprRRQEsbJ3IB7vZie4',
      },
      body: JSON.stringify({
        user: {
          userId: username,
          password: password,
          mobileDeviceId: 'WEB',
          deviceTokenId: 'WEB',
          appType: 'WEB',
          appVersion: '1.0',
          timeZone: 'America/Los_Angeles',
          mobileDeviceName: 'chrome',
          deviceType: 'WEB',
          ipAddress: ip,
          isSmartHVAC: 0,
          locale: 'en',
        },
      }),
    };
    const loginData = await fetch(appUserUrl, appUserPayload)
      .then((response) => response.json())
      .then((responseJSON) => {
        // console.log(responseJSON);
        const initialLoginData = responseJSON.data.user;
        return initialLoginData;
      })
      .catch((error) => {
        console.error(error);
      });
    return loginData;
  }

  /**
   * Performs the initial subscription to the API, providing current status of
   * all devices in the account.
   *
   * @param {any} accessCredentials A JSON object containing valid credentials
   * @returns {Promise<any>} A Promise containing the JSON response
   */
  async #getDeviceInfo() {
    const deviceInfoUrl = new URL(
      API_HTTP_PROTOCOL + API_HOST + '/web/devices?limit=420',
    );
    const deviceInfoPayload = {
      agent: this.#agent,
      method: 'GET',
      headers: {
        authority: 'api.smartcielo.com',
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.9',
        authorization: this.#accessToken,
        'cache-control': 'no-cache',
        'content-type': 'application/json; charset=utf-8',
        origin: 'https://home.cielowigle.com',
        pragma: 'no-cache',
        referer: 'https://home.cielowigle.com/',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': 'macOS',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'cross-site',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
        'x-api-key': '7xTAU4y4B34u8DjMsODlEyprRRQEsbJ3IB7vZie4',
      },
    };
    const devicesData = await fetch(deviceInfoUrl, deviceInfoPayload)
      .then((response) => response.json())
      .then((responseJSON) => {
        // console.log("devicesResponse... ", responseJSON.data.listDevices);
        return responseJSON;
      })
      .catch((error) => {
        console.error(error);
        return;
      });
    return devicesData;
  }

  /**
   * Starts the WebSocket connection and periodically pings it to keep it
   * alive
   *
   * @returns {Promise<any>} A Promise containing nothing if resolved, and an
   *      error if rejected
   */
  async #startSocket() {
    // Periodically ping the socket to keep it alive, seems to be unnessesary with current API
    // setInterval(async () => {
    //   try {
    //     console.log('pinging socket');
    //     await this.#pingSocket();
    //   } catch (error) {
    //     this.#errorCallback(error);
    //   }
    // }, PING_INTERVAL);

    return Promise.resolve();
  }

  /**
   *This refreshes the token by returning a refreshed token, may not be neccesary with the new API
   * @returns
   */
  async #pingSocket() {
    const time = new Date();
    const pingUrl = new URL(
      'https://api.smartcielo.com/web/token/refresh' +
        '?refreshToken=' +
        this.#accessToken,
    );
    const pingPayload = {
      agent: this.#agent,
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        authorization: this.#accessToken,
        'cache-control': 'no-cache',
        'content-type': 'application/json; charset=utf-8',
        pragma: 'no-cache',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'cross-site',
        'x-api-key': '7xTAU4y4B34u8DjMsODlEyprRRQEsbJ3IB7vZie4',
      },
      referrer: 'https://home.cielowigle.com/',
      referrerPolicy: 'strict-origin-when-cross-origin',
      body: null,
      method: 'GET',
      mode: 'cors',
      credentials: 'include',
    };
    const pingResponse = await fetch(pingUrl, pingPayload)
      .then((response) => response.json())
      .then((responseJSON) => {
        const expires = new Date(responseJSON.data.expiresIn * 1000);
        // Calculate the difference between the two dates in minutes
        const diffMinutes = Math.round((expires - time) / 60000);

        // Log the difference to the console
        console.log(
          `The refreshed token will expire in ${diffMinutes} minutes.`,
        );
        return responseJSON;
      })
      .catch((error) => {
        console.error(error);
        return;
      });

    return pingResponse;
  }

  // Utility methods
  /**
   * Creates an object containing all necessary fields for a command
   *
   * @param {string} temp Temperature setting
   * @param {string} power Power state, on or off
   * @param {string} fanspeed Fan speed setting
   * @param {string} mode Mode setting, heat, cool, or auto
   * @param {string} macAddress Device MAC address
   * @param {number} applianceID Appliance ID
   * @param {boolean} isAction Whether or not the command is an action
   * @param {string} performedAction Value this command is modifying
   * @param {string} performedValue Updated value for command
   * @param {string} mid Session ID
   * @param {string} deviceTypeVersion Device type version
   * @param {string} fwVersion Firmware version
   * @returns {any}
   */
  #buildCommand(
    temp,
    power,
    fanspeed,
    mode,
    isAction,
    performedAction,
    performedValue,
  ) {
    return {
      fanspeed: fanspeed,
      light: 'off',
      mode: isAction && performedAction === 'mode' ? performedValue : mode,
      oldPower: power,
      power: power,
      swing: 'auto/stop',
      temp: isAction && performedAction === 'temp' ? performedValue : temp,
      turbo: 'off',
    };
  }

  /**
   * Returns a JSON command payload to execute a parameter change
   *
   * @param {CieloHVAC} hvac The HVAC to perform the action on
   * @param {string} performedAction The parameter to change
   * @param {string} performedActionValue The value to change it to
   * @returns {string}
   */
  #buildCommandPayload(hvac, performedAction, performedActionValue) {
    const commandCount = this.#commandCount++;
    const deviceTypeVersion = 'BP01';
    const result = JSON.stringify({
      action: 'actionControl',
      actionSource: 'WEB',
      actionType: performedAction,
      actionValue: performedActionValue,
      actions: this.#buildCommand(
        hvac.getTemperature(),
        hvac.getPower(),
        hvac.getFanSpeed(),
        hvac.getMode(),
        true,
        performedAction,
        performedActionValue,
      ),
      applianceId: hvac.getApplianceID(),
      applianceType: 'AC',
      application_version: '1.0.0',
      connection_source: 0,
      deviceTypeVersion: deviceTypeVersion,
      fwVersion: hvac.getFwVersion(),
      macAddress: hvac.getMacAddress(),
      mid: this.#sessionID,
      token: this.#accessToken,
      ts: Math.round(Date.now() / 1000),
    });
    return result;
  }

  /**
   * Sends a command to the HVAC
   *
   * @param {CieloHVAC} hvac The HVAC to perform the action on
   * @param {string} performedAction The parameter to change
   * @param {string} performedActionValue The value to change it to
   * @returns {Promise<void>}
   */
  async sendCommand(hvac, performedAction, performedActionValue) {
    return new Promise((resolve, reject) => {
      this.#ws.send(
        this.#buildCommandPayload(hvac, performedAction, performedActionValue),
        (error) => {
          if (error) {
            log.error(error);
            reject(error);
          } else {
            resolve();
          }
        },
      );
    });
  }
}

class CieloHVAC {
  #power = DEFAULT_POWER;
  #temperature = DEFAULT_TEMPERATURE;
  #mode = DEFAULT_MODE;
  #fanSpeed = DEFAULT_FAN;
  #roomTemperature = DEFAULT_TEMPERATURE;
  #deviceName = 'HVAC';
  #macAddress = '0000000000';
  #applianceID = 0;
  #fwVersion = '0.0.0';

  /**
   * Creates a new HVAC with the provided parameters
   *
   * @param {string} macAddress HVAC's MAC address
   * @param {string} deviceName HVAC's name
   * @param {number} applianceID Internal appliance ID
   * @param {string} fwVersion Firmware version
   */
  constructor(macAddress, deviceName, applianceID, fwVersion) {
    this.#macAddress = macAddress;
    this.#deviceName = deviceName;
    this.#applianceID = applianceID;
    this.#fwVersion = fwVersion;
  }

  /**
   * Returns the current power state
   *
   * @returns {string}
   */
  getPower() {
    return this.#power;
  }

  /**
   * Returns the current temperature setting
   *
   * @returns {string}
   */
  getTemperature() {
    return this.#temperature;
  }

  /**
   * Returns the current mode setting
   *
   * @returns {string}
   */
  getMode() {
    return this.#mode;
  }

  /**
   * Returns the current fan speed
   *
   * @returns {string}
   */
  getFanSpeed() {
    return this.#fanSpeed;
  }

  /**
   * Returns the current room temperature
   *
   * @returns {string}
   */
  getRoomTemperature() {
    return this.#roomTemperature;
  }

  /**
   * Returns the device's MAC address
   *
   * @returns {string}
   */
  getMacAddress() {
    return this.#macAddress;
  }

  /**
   * Returns the appliance ID
   *
   * @returns {number}
   */
  getApplianceID() {
    return this.#applianceID;
  }

  /**
   * Returns the device's firmware version
   *
   * @returns {string}
   */
  getFwVersion() {
    return this.#fwVersion;
  }

  /**
   * Returns the device's name
   *
   * @returns {string}
   */
  getDeviceName() {
    return this.#deviceName;
  }

  /**
   * Returns a string representation containing state data
   *
   * @returns {string}
   */
  toString() {
    return (
      this.#deviceName +
      ' ' +
      this.#macAddress +
      ': ' +
      [
        this.#power,
        this.#mode,
        this.#fanSpeed,
        this.#temperature,
        this.#roomTemperature,
      ].join(', ')
    );
  }

  /**
   * Updates the state of the HVAC using the provided parameters
   *
   * @param {string} power Updated power state, on or off
   * @param {string} temperature Updated temperature setting
   * @param {string} mode Updated mode, heat, cool, or auto
   * @param {string} fanSpeed Updated fan speed
   */
  updateState(power, temperature, mode, fanSpeed) {
    // TODO: Do some bounds checking
    this.#power = power;
    this.#temperature = temperature;
    this.#mode = mode;
    this.#fanSpeed = fanSpeed;
  }

  /**
   * Updates the measured room temperature
   *
   * @param {string} roomTemperature Updated room temperature
   */
  updateRoomTemperature(roomTemperature) {
    this.#roomTemperature = roomTemperature;
  }

  setMode(mode, api) {
    return api.sendCommand(this, 'mode', mode);
  }

  setFanSpeed(fanspeed, api) {
    return api.sendCommand(this, 'fanspeed', fanspeed);
  }

  setTemperature(temperature, api) {
    return api.sendCommand(this, 'temp', temperature);
  }

  /**
   * Powers on the HVAC
   *
   * @param {CieloAPIConnection} api The API to use to execute the command
   * @return {Promise<void>}
   */
  powerOn(api) {
    return api.sendCommand(this, 'power', 'on');
  }

  /**
   * Powers off the HVAC
   *
   * @param {CieloAPIConnection} api The API to use to execute the command
   * @return {Promise<void>}
   */
  powerOff(api) {
    return api.sendCommand(this, 'power', 'off');
  }
}

module.exports = {
  CieloHVAC: CieloHVAC,
  CieloAPIConnection: CieloAPIConnection,
};
