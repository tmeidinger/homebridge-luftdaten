'use strict';
var http = require('http');
var Service;
var Characteristic;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory("homebridge-luftdaten", "Luftdaten", luftdatenAccessory);
}

function luftdatenAccessory(log, config) {
  var informationService;
  var temperatureService;
  var humidityService;
  var airqualityService;

  this.log = log;
  this.host = config["host"];

  this.pm10 = 0;
  this.pm2_5 = 0;
  this.temp = 0;
  this.humidity = 0;
  this.air_status = 0;
  this.software_version = '';
  this.e_counter = 10;

  this.refresh();

  setInterval((function() {
    this.refresh();
  }).bind(this), 60000);
}

luftdatenAccessory.prototype = {

  identify: function(callback) {
    this.log("Identify requested!");
    callback();
  },

  refresh: function() {
    var that = this;
    var options = {
      host: that.host,
      port: 80,
      method: 'GET',
      path: '/data.json'
    };

    function parseSensorData(air) {
      if (that.software_version !== air.software_version) {
        that.log("software_version " + that.software_version + " -> " + air.software_version);
        that.software_version = air.software_version;
        that.informationService.setCharacteristic(Characteristic.SerialNumber, that.software_version);
      }
      for (let i = 0; i < air.sensordatavalues.length; i++) {
        if (air.sensordatavalues[i].value_type === 'temperature') {
          // that.log(air.sensordatavalues[i].value_type, air.sensordatavalues[i].value);
          that.temp = Number(air.sensordatavalues[i].value);
          that.temperatureService.setCharacteristic(Characteristic.CurrentTemperature, that.temp);
        } else if (air.sensordatavalues[i].value_type === 'humidity') {
          // that.log(air.sensordatavalues[i].value_type, air.sensordatavalues[i].value);
          that.humidity = Math.round(Number(air.sensordatavalues[i].value));
          that.humidityService.setCharacteristic(Characteristic.CurrentRelativeHumidity, that.humidity);
        } else if (air.sensordatavalues[i].value_type === 'SDS_P1') {
          // that.log(air.sensordatavalues[i].value_type, air.sensordatavalues[i].value);
          that.pm10 = Math.round(Number(air.sensordatavalues[i].value));
          that.airqualityService.setCharacteristic(Characteristic.PM10Density, that.pm10);
        } else if (air.sensordatavalues[i].value_type === 'SDS_P2') {
          // that.log(air.sensordatavalues[i].value_type, air.sensordatavalues[i].value);
          that.pm2_5 = Math.round(Number(air.sensordatavalues[i].value));
          that.airqualityService.setCharacteristic(Characteristic.PM2_5Density, that.pm2_5);
        }
      }
      if (that.pm2_5 <= 25 && that.pm10 <= 25) {
        that.air_status = 1;
      } else if (that.pm2_5 <= 50 && that.pm10 <= 50) {
        that.air_status = 2;
      } else if (that.pm2_5 <= 75 && that.pm10 <= 75) {
        that.air_status = 3;
      } else if (that.pm2_5 <= 100 && that.pm10 <= 100) {
        that.air_status = 4;
      } else {
        that.air_status = 5;
      }
      that.airqualityService.setCharacteristic(Characteristic.AirQuality, that.air_status);
      that.e_counter = 10;
    }

    function parseBody(body) {
      body = body.replace(/,]/g, ']');
      try {
        let air = JSON.parse(body);
        parseSensorData(air);
      } catch (e) {
        that.log("JSON.parse exception");
      }
    }

    function parseResponse(response) {
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => body += chunk);
      response.on('end', () => parseBody(body));
    }

    function parseLuftdaten(response) {
      if (response.statusCode === 200 && /^application\/json/.test(response.headers['content-type'])) {
        parseResponse(response);
      } else {
        response.resume();
      }
    }

    // that.log("Refreshing " + that.host + "...");
    that.e_counter--;
    http.get(options, parseLuftdaten).on('error', (e) => {
      that.log('http.get error');
    });
  },

  getCurrentTemperature: function(callback) {
    var that = this;

    that.log("getCurrentTemperature/Humidity " + that.temp + "/" + that.humidity);
    that.humidityService.setCharacteristic(Characteristic.CurrentRelativeHumidity, that.humidity);
    callback(null, that.temp);
  },

  getAirQuality: function(callback) {
    var that = this;

    that.log("getAirQuality " + that.air_status);

    if (that.e_counter <= 0) {
      that.air_status = 0;
      that.pm_10 = 1000;
      that.pm_2_5 = 1000;
      that.temp = 100;
      that.humidity = 100;
    }

    that.airqualityService.setCharacteristic(Characteristic.PM10Density, that.pm10);
    that.airqualityService.setCharacteristic(Characteristic.PM2_5Density, that.pm2_5);
    callback(null, that.air_status);
  },

  getServices: function() {
    this.informationService = new Service.AccessoryInformation();
    this.temperatureService = new Service.TemperatureSensor();
    this.humidityService = new Service.HumiditySensor();
    this.airqualityService = new Service.AirQualitySensor();

    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, "Luftdaten")
      .setCharacteristic(Characteristic.Model, "NodeMCU")
      .setCharacteristic(Characteristic.Name, this.name)
      .setCharacteristic(Characteristic.SerialNumber, this.host);

    this.temperatureService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', this.getCurrentTemperature.bind(this));

    this.airqualityService
      .getCharacteristic(Characteristic.AirQuality)
      .on('get', this.getAirQuality.bind(this));

    this.airqualityService
      .getCharacteristic(Characteristic.PM2_5Density);

    this.airqualityService
      .getCharacteristic(Characteristic.PM10Density);

    return [this.informationService, this.temperatureService, this.humidityService, this.airqualityService];
  }
};
