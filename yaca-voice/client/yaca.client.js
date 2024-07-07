import * as alt from 'alt-client';
import * as natives from 'natives';


//For typescript users
/*
declare module "alt-client" {
    export interface LocalPlayer {
        yacaPluginLocal: {
            canChangeVoiceRange: boolean;

            lastMegaphoneState: boolean;
            canUseMegaphone: boolean;
        }
    }

    export interface Player {
        yacaPlugin: {
            clientId: string,
            forceMuted: boolean,
            range: number,
            phoneCallMemberIds?: number[],
            isTalking: boolean,
        }
    }
}
*/

const YacaFilterEnum = {
    "RADIO": "RADIO",
    "MEGAPHONE": "MEGAPHONE",
    "PHONE": "PHONE",
    "PHONE_SPEAKER": "PHONE_SPEAKER",
    "INTERCOM": "INTERCOM",
    "PHONE_HISTORICAL": "PHONE_HISTORICAL",
};

const YacaStereoMode = {
    "MONO_LEFT": "MONO_LEFT",
    "MONO_RIGHT": "MONO_RIGHT",
    "STEREO": "STEREO",
};

const YacaBuildType = {
    "RELEASE": 0,
    "DEVELOP": 1
};

const CommDeviceMode = {
    SENDER: 0,
    RECEIVER: 1,
    TRANSCEIVER: 2,
};

/**
 * @typedef {Object} YacaResponse
 * @property {"RENAME_CLIENT" | "MOVE_CLIENT" | "MUTE_STATE" | "TALK_STATE" | "OK" | "WRONG_TS_SERVER" | "NOT_CONNECTED" | "MOVE_ERROR" | "OUTDATED_VERSION" | "WAIT_GAME_INIT" | "HEARTBEAT"} code - The response code.
 * @property {string} requestType - The type of the request.
 * @property {string} message - The response message.
 */

const settings = {
    // Max Radio Channels
    maxRadioChannels: 9, // needs to be sync with serverside setting

    // Max phone speaker range
    maxPhoneSpeakerRange: 5,
}

const lipsyncAnims = {
    true: {
        name: "mic_chatter",
        dict: "mp_facial"
    },
    false: {
        name: "mood_normal_1",
        dict: "facials@gen_male@variations@normal"
    }
}

const defaultRadioChannelSettings = {
    volume: 1,
    stereo: YacaStereoMode.STEREO,
    muted: false,
    frequency: 0,
}

// Values are in meters
const voiceRangesEnum = {
    1: 1,
    2: 3,
    3: 8,
    4: 15,
    5: 20,
    6: 25,
    7: 30,
    8: 40,
}

const translations = {
    "plugin_not_activated": "Please activate your voiceplugin!",
    "connect_error": "Error while connecting to voiceserver, please reconnect!",
    "plugin_not_initializiaed": "Plugin not initialized!",

    // Error message which comes from the plugin
    "OUTDATED_VERSION": "You dont use the required plugin version!",
    "WRONG_TS_SERVER": "You are on the wrong teamspeakserver!",
    "NOT_CONNECTED": "You are on the wrong teamspeakserver!",
    "MOVE_ERROR": "Error while moving into ingame teamspeak channel!",
    "WAIT_GAME_INIT": "",
    "HEARTBEAT": ""
}

export class YaCAClientModule {
    static instance = null;
    static allPlayers = new Map();

    localPlayer = alt.Player.local;
    rangeInterval = null;
    monitorInterval = null;
    websocket = null;
    noPluginActivated = 0;
    messageDisplayed = false;
    visualVoiceRangeTimeout = null;
    visualVoiceRangeTick = null;
    uirange = 2;
    lastuiRange = 2;
    isTalking = false;
    firstConnect = true;
    isPlayerMuted = false;

    radioFrequenceSetted = false;
    radioToggle = false;
    radioEnabled = false;
    radioTalking = false;
    radioChannelSettings = {};
    radioInited = false;
    activeRadioChannel = 1;
    playersWithShortRange = new Map();
    playersInRadioChannel = new Map();

    inCall = new Set();
    phoneSpeakerActive = false;
    currentlySendingPhoneSpeakerSender = new Set();
    currentlyPhoneSpeakerApplied = new Set();

    vehicleMufflingWhitelist = new Set();

    useWhisper = false;

    webview = new alt.WebView('http://assets/yaca-ui/assets/index.html');

    mhinTimeout = null;
    mhintTick = null;
    /**
     * Displays a hint message.
     *
     * @param {string} head - The heading of the hint.
     * @param {string} msg - The message to be displayed.
     * @param {number} [time=0] - The duration for which the hint should be displayed. If not provided, defaults to 0.
     */
    mhint(head, msg, time = 0) {
        const scaleform = natives.requestScaleformMovie("MIDSIZED_MESSAGE");

        this.mhinTimeout = alt.setTimeout(() => {
            this.mhinTimeout = null;

            if (!natives.hasScaleformMovieLoaded(scaleform)) {
                this.mhint(head, msg, time);
                return;
            }

            natives.beginScaleformMovieMethod(scaleform, "SHOW_MIDSIZED_MESSAGE");
            natives.beginTextCommandScaleformString("STRING");
            natives.scaleformMovieMethodAddParamPlayerNameString(head);
            natives.scaleformMovieMethodAddParamTextureNameString(msg);
            natives.scaleformMovieMethodAddParamInt(100);
            natives.scaleformMovieMethodAddParamBool(true);
            natives.scaleformMovieMethodAddParamInt(100);
            natives.endScaleformMovieMethod();

            this.mhintTick = new alt.Utils.EveryTick(() => {
                natives.drawScaleformMovieFullscreen(scaleform, 255, 255, 255, 255, 0);
            });

            if (time != 0) {
                alt.setTimeout(() => {
                    this.mhintTick?.destroy();
                }, time * 1000);
            }
        }, natives.hasScaleformMovieLoaded(scaleform) ? 0 : 1000);
    }

    stopMhint() {
        if (this.mhinTimeout) alt.clearTimeout(this.mhinTimeout);
        this.mhinTimeout = null;
        this.mhintTick?.destroy();
    }

    /**
     * Clamps a value between a minimum and maximum value.
     *
     * @param {number} value - The value to be clamped.
     * @param {number} [min=0] - The minimum value. Defaults to 0 if not provided.
     * @param {number} [max=1] - The maximum value. Defaults to 1 if not provided.
     */
    clamp(value, min = 0, max = 1) {
        return Math.max(min, Math.min(max, value))
    }

    /**
     * Sends a radar notification.
     *
     * @param {string} message - The message to be sent in the notification.
     */
    radarNotification(message) {
        /*
        ~g~ --> green
        ~w~ --> white
        ~r~ --> white
        */

        natives.beginTextCommandThefeedPost("STRING");
        natives.addTextComponentSubstringPlayerName(message);
        natives.endTextCommandThefeedPostTicker(false, false);
    }

    constructor() {
        this.localPlayer.yacaPluginLocal = {
            canChangeVoiceRange: true,
            lastMegaphoneState: false,
            canUseMegaphone: false,
        };

        const config = JSON.parse(alt.File.read('./config.json'));
        for (const vehicleModel of config.VehicleMufflingWhitelist) {
            this.vehicleMufflingWhitelist.add(alt.hash(vehicleModel));
        }

        this.registerEvents();

        alt.log('[Client] YaCA Client loaded');
    }

    /***
     * Gets the singleton of YaCAClientModule
     * 
     * @returns {YaCAClientModule}
     */
    static getInstance() {
        if (!this.instance) {
            this.instance = new YaCAClientModule();
        }

        return this.instance;
    }

    registerEvents() {
        alt.onServer("client:yaca:init", (dataObj) => {
            if (this.rangeInterval) {
                alt.clearInterval(this.rangeInterval);
                this.rangeInterval = null;
            }

            if (!this.websocket) {
                this.websocket = new alt.WebSocketClient('ws://127.0.0.1:30125');
                this.websocket.on('message', msg => {
                    this.handleResponse(msg);
                });

                this.websocket.on('error', reason => alt.logError('[YACA-Websocket] Error: ', reason));
                this.websocket.on('close', (code, reason) => alt.logError('[YACA-Websocket]: client disconnected', code, reason));
                this.websocket.on('open', () => {
                    if (this.firstConnect) {
                        this.initRequest(dataObj);
                        this.firstConnect = false;
                    } else {
                        alt.emitServerRaw("server:yaca:wsReady", this.firstConnect);
                    }

                    alt.log('[YACA-Websocket]: connected');
                });

                this.websocket.perMessageDeflate = true;
                this.websocket.autoReconnect = true;
                this.websocket.start();

                // Monitoring if player is in ingame voice channel
                this.monitorInterval = alt.setInterval(this.monitorConnectstate.bind(this), 1000);
            }

            if (this.firstConnect) return;

            this.initRequest(dataObj);
        });

        alt.onServer("client:yaca:disconnect", (remoteID) => {
            YaCAClientModule.allPlayers.delete(remoteID);
            this.inCall.delete(remoteID);
        });

        alt.onServer("client:yaca:addPlayers", (dataObjects) => {
            if (!Array.isArray(dataObjects)) dataObjects = [dataObjects];

            let enablePhoneCall = false;
            for (const dataObj of dataObjects) {
                if (!dataObj || typeof dataObj.range == "undefined" || typeof dataObj.clientId == "undefined" || typeof dataObj.playerId == "undefined") continue;

                const currentData = this.getPlayerByID(dataObj.playerId);

                YaCAClientModule.allPlayers.set(dataObj.playerId, {
                    remoteID: dataObj.playerId,
                    clientId: dataObj.clientId,
                    forceMuted: dataObj.forceMuted,
                    range: dataObj.range,
                    isTalking: false,
                    phoneCallMemberIds: currentData?.phoneCallMemberIds || undefined,
                    mutedOnPhone: dataObj.mutedOnPhone,
                })

                if (this.inCall.has(dataObj.playerId)) {
                    enablePhoneCall = true;
                }
            }

            if (enablePhoneCall) this.enablePhoneCall(Array.from(this.inCall), true);
        });

        /**
         * Handles the "client:yaca:muteTarget" server event.
         *
         * @param {number} target - The target to be muted.
         * @param {boolean} muted - The mute status.
         */
        alt.onServer("client:yaca:muteTarget", (target, muted) => {
            const player = this.getPlayerByID(target);
            if (player) player.forceMuted = muted;
        });

        /* =========== RADIO SYSTEM =========== */
        this.webview.on('client:yaca:enableRadio', (state) => {
            if (!this.isPluginInitialized()) return;

            if (this.radioEnabled != state) {
                this.radioEnabled = state;
                alt.emitServerRaw("server:yaca:enableRadio", state);

                if (!state) {
                    for (let i = 1; i <= settings.maxRadioChannels; i++) {
                        this.disableRadioFromPlayerInChannel(i);
                    }
                }
            }

            if (state && !this.radioInited) {
                this.radioInited = true;
                this.initRadioSettings();
                this.updateRadioInWebview(this.activeRadioChannel);
            }
        });

        this.webview.on('client:yaca:changeRadioFrequency', (frequency) => {
            if (!this.isPluginInitialized()) return;

            alt.emitServerRaw("server:yaca:changeRadioFrequency", this.activeRadioChannel, frequency);
        });

        alt.onServer("client:yaca:setRadioFreq", (channel, frequency) => {
            this.setRadioFrequency(channel, frequency);
        });

        alt.onServer("client:yaca:radioTalking", (target, frequency, state, infos, self = false) => {
            if (self) {
                this.radioTalkingStateToPluginWithWhisper(state, target);
                return;
            }

            const channel = this.findRadioChannelByFrequency(frequency);
            if (!channel) return;
            
            const player = this.getPlayerByID(target);
            if (!player) return;

            const info = infos[this.localPlayer.remoteID];

            if (!info?.shortRange || (info?.shortRange && alt.Player.getByRemoteID(target)?.isSpawned)) {
                YaCAClientModule.setPlayersCommType(player, YacaFilterEnum.RADIO, state, channel, undefined, CommDeviceMode.RECEIVER, CommDeviceMode.SENDER);
            }

            state ? this.playersInRadioChannel.get(channel)?.add(target) : this.playersInRadioChannel.get(channel)?.delete(target);

            if (info?.shortRange || !state) {
                if (state) {
                    this.playersWithShortRange.set(target, frequency)
                } else {
                    this.playersWithShortRange.delete(target)
                }
            }
        });

        this.webview.on('client:yaca:muteRadioChannel', () => {
            if (!this.isPluginInitialized() || !this.radioEnabled) return;

            const channel = this.activeRadioChannel;
            if (this.radioChannelSettings[channel].frequency == 0) return;
            alt.emitServerRaw("server:yaca:muteRadioChannel", channel)
        });

        alt.onServer("client:yaca:setRadioMuteState", (channel, state) => {
            this.radioChannelSettings[channel].muted = state;
            this.updateRadioInWebview(channel);
            this.disableRadioFromPlayerInChannel(channel);
        });

        alt.onServer("client:yaca:leaveRadioChannel", (client_ids, frequency) => {
            if (!Array.isArray(client_ids)) client_ids = [client_ids];

            const channel = this.findRadioChannelByFrequency(frequency);

            if (client_ids.includes(this.getPlayerByID(this.localPlayer.remoteID)?.clientId)) this.setRadioFrequency(channel, 0);

            this.sendWebsocket({
                base: {"request_type": "INGAME"},
                comm_device_left: {
                    comm_type: YacaFilterEnum.RADIO,
                    client_ids: client_ids,
                    channel: channel
                }
            });
        });

        this.webview.on('client:yaca:changeActiveRadioChannel', (channel) => {
            if (!this.isPluginInitialized() || !this.radioEnabled) return;

            alt.emitServerRaw('server:yaca:changeActiveRadioChannel', channel);
            this.activeRadioChannel = channel;
            this.updateRadioInWebview(channel);
        });

        this.webview.on('client:yaca:changeRadioChannelVolume', (higher) => {
            if (!this.isPluginInitialized() || !this.radioEnabled || this.radioChannelSettings[this.activeRadioChannel].frequency == 0) return;

            const channel = this.activeRadioChannel;
            const oldVolume = this.radioChannelSettings[channel].volume;
            this.radioChannelSettings[channel].volume = this.clamp(
                oldVolume + (higher ? 0.17 : -0.17),
                0,
                1
            )

            // Prevent event emit spams, if nothing changed
            if (oldVolume == this.radioChannelSettings[channel].volume) return

            if (this.radioChannelSettings[channel].volume == 0 || (oldVolume == 0 && this.radioChannelSettings[channel].volume > 0)) {
                alt.emitServerRaw("server:yaca:muteRadioChannel", channel)
            }

            // Prevent duplicate update, cuz mute has its own update
            if (this.radioChannelSettings[channel].volume > 0) this.updateRadioInWebview(channel);

            // Send update to voiceplugin
            this.setCommDeviceVolume(YacaFilterEnum.RADIO, this.radioChannelSettings[channel].volume, channel);
        });

        this.webview.on("client:yaca:changeRadioChannelStereo", () => {
            if (!this.isPluginInitialized() || !this.radioEnabled) return;

            const channel = this.activeRadioChannel;

            switch (this.radioChannelSettings[channel].stereo) {
                case YacaStereoMode.STEREO:
                    this.radioChannelSettings[channel].stereo = YacaStereoMode.MONO_LEFT;
                    this.radarNotification(`Kanal ${channel} ist nun auf der linken Seite hörbar.`);
                    break;
                case YacaStereoMode.MONO_LEFT:
                    this.radioChannelSettings[channel].stereo = YacaStereoMode.MONO_RIGHT;
                    this.radarNotification(`Kanal ${channel} ist nun auf der rechten Seite hörbar.`);
                    break;
                case YacaStereoMode.MONO_RIGHT:
                    this.radioChannelSettings[channel].stereo = YacaStereoMode.STEREO;
                    this.radarNotification(`Kanal ${channel} ist nun auf beiden Seiten hörbar.`);
            };

            // Send update to voiceplugin
            this.setCommDeviceStereomode(YacaFilterEnum.RADIO, this.radioChannelSettings[channel].stereo, channel);
        });

        //TODO: Implement, will be used if player activates radio speaker so everyone around him can hear it
        this.webview.on("client:yaca:changeRadioSpeaker", () => {

        })

        /* =========== INTERCOM SYSTEM =========== */
        /**
         * Handles the "client:yaca:addRemovePlayerIntercomFilter" server event.
         *
         * @param {Number[] | Number} playerIDs - The IDs of the players to be added or removed from the intercom filter.
         * @param {boolean} state - The state indicating whether to add or remove the players.
         */
        alt.onServer("client:yaca:addRemovePlayerIntercomFilter", (playerIDs, state) => {
            if (!Array.isArray(playerIDs)) playerIDs = [playerIDs];

            let playersToRemove = [],
                playersToAdd = [];
            for (let playerID of playerIDs) {
                let player = this.getPlayerByID(playerID);
                if (!player) continue;
                if (!state) {
                    playersToRemove.push(player);
                    continue;
                }

                playersToAdd.push(player);
            }

            if (playersToRemove.length) {
                YaCAClientModule.setPlayersCommType(playersToRemove, YacaFilterEnum.INTERCOM, false, undefined, undefined, CommDeviceMode.TRANSCEIVER, CommDeviceMode.TRANSCEIVER);
            }

            if (playersToAdd.length) {
                YaCAClientModule.setPlayersCommType(playersToAdd, YacaFilterEnum.INTERCOM, true, undefined, undefined, CommDeviceMode.TRANSCEIVER, CommDeviceMode.TRANSCEIVER);
            }
        });

        /* =========== PHONE SYSTEM =========== */
        /**
         * Handles the "client:yaca:phone" server event.
         *
         * @param {number} targetID - The ID of the target.
         * @param {boolean} state - The state of the phone.
         */
        alt.onServer("client:yaca:phone", (targetIDs, state) => {
            if (!Array.isArray(targetIDs)) targetIDs = [targetIDs];

            this.enablePhoneCall(targetIDs, state, YacaFilterEnum.PHONE);
        });

        /**
         * Handles the "client:yaca:phoneOld" server event.
         *
         * @param {number} targetID - The ID of the target.
         * @param {boolean} state - The state of the phone.
         */
        alt.onServer("client:yaca:phoneOld", (targetIDs, state) => {
            if (!Array.isArray(targetIDs)) targetIDs = [targetIDs];

            this.enablePhoneCall(targetIDs, state, YacaFilterEnum.PHONE_HISTORICAL);
        });

        alt.onServer("client:yaca:phoneMute", (targetID, state, onCallstop = false) => {
            const target = this.getPlayerByID(targetID);
            if (!target) return;

            target.mutedOnPhone = state;

            if (onCallstop) return;

            if (this.useWhisper && target.remoteID == this.localPlayer.remoteID) {
                YaCAClientModule.setPlayersCommType(
                    [],
                    YacaFilterEnum.PHONE,
                    !state,
                    undefined,
                    undefined,
                    CommDeviceMode.SENDER
                );
            } else if (!this.useWhisper) {
                if (state) {
                    YaCAClientModule.setPlayersCommType(target, YacaFilterEnum.PHONE, false, undefined, undefined, CommDeviceMode.TRANSCEIVER, CommDeviceMode.TRANSCEIVER);
                } else {
                    YaCAClientModule.setPlayersCommType(target, YacaFilterEnum.PHONE, true, undefined, undefined, CommDeviceMode.TRANSCEIVER, CommDeviceMode.TRANSCEIVER);
                }
            }
        })

        alt.onServer("client:yaca:playersToPhoneSpeakerEmit", (playerIDs, state) => {
            if (!Array.isArray(playerIDs)) playerIDs = [playerIDs];

            let applyPhoneSpeaker = new Set();
            let phoneSpeakerRemove = new Set();
            for (const playerID of playerIDs) {
                const player = this.getPlayerByID(playerID);
                if (!player) continue;

                if (state) {
                    applyPhoneSpeaker.add(player);
                } else {
                    phoneSpeakerRemove.add(player);
                }
            }

            if (applyPhoneSpeaker.size) YaCAClientModule.setPlayersCommType(Array.from(applyPhoneSpeaker), YacaFilterEnum.PHONE_SPEAKER, true, undefined, undefined, CommDeviceMode.SENDER, CommDeviceMode.RECEIVER);
            if (phoneSpeakerRemove.size) YaCAClientModule.setPlayersCommType(Array.from(phoneSpeakerRemove), YacaFilterEnum.PHONE_SPEAKER, false, undefined, undefined, CommDeviceMode.SENDER, CommDeviceMode.RECEIVER);
        });

        /* =========== alt:V Events =========== */
        alt.on("keydown", (key) => {
            switch (key) {
                case 96: // Numpad 0
                    this.useMegaphone(true);
                    break;
                case 220: // Backslash
                    this.radioTalkingStart(true);
                    break;
                case 107: // Numpad +
                    this.changeVoiceRange(1);
                    break;
                case 80: // P
                    this.openRadio();
                    break;
            }
        });

        alt.on("keyup", (key) => {
            switch (key) {
                case 96: // Numpad 0
                    this.useMegaphone(false);
                    break;
                case 220: // Backslash
                    this.radioTalkingStart(false);
                    break;
                case 109: // Numpad -
                    this.changeVoiceRange(-1);
                    break;
            }
        });

        alt.on("streamSyncedMetaChange", (entity, key, newValue, oldValue) => {
            if (!entity?.valid || !(entity instanceof alt.Player) || !entity.isSpawned) return;

            this.handleSyncedMetas(entity, key, newValue, oldValue);
        });

        alt.on("gameEntityCreate", (entity) => {
            if (!entity?.valid || !(entity instanceof alt.Player)) return;

            const keys = entity.getStreamSyncedMetaKeys();
            for (const key of keys) {
                this.handleSyncedMetas(entity, key, entity.getStreamSyncedMeta(key));
            }

            // Handle shortrange radio on stream-in
            if (this.playersWithShortRange.has(entity.remoteID)) {
                const channel = this.findRadioChannelByFrequency(this.playersWithShortRange.get(entityID));
                if (channel) {
                    YaCAClientModule.setPlayersCommType(this.getPlayerByID(entityID), YacaFilterEnum.RADIO, true, channel, undefined, CommDeviceMode.RECEIVER, CommDeviceMode.SENDER);
                }
            }
        });

        alt.on("gameEntityDestroy", (entity) => {
            if (!entity?.valid || !(entity instanceof alt.Player)) return;

            const entityID = entity.remoteID;

            // Handle phonecallspeaker on stream-out
            this.removePhoneSpeakerFromEntity(entity);

            // Handle megaphone on stream-out
            if (entity?.hasStreamSyncedMeta("yaca:megaphoneactive")) {
                YaCAClientModule.setPlayersCommType(this.getPlayerByID(entityID), YacaFilterEnum.MEGAPHONE, false, undefined, undefined, CommDeviceMode.RECEIVER, CommDeviceMode.SENDER);
            }

            // Handle shortrange radio on stream-out
            if (this.playersWithShortRange.has(entityID)) {
                YaCAClientModule.setPlayersCommType(this.getPlayerByID(entityID), YacaFilterEnum.RADIO, false, undefined, undefined, CommDeviceMode.RECEIVER, CommDeviceMode.SENDER);
            }
        });
    }

    /* ======================== Helper Functions ======================== */
    handleSyncedMetas(entity, key, value, oldValue) {
        const isOwnPlayer = entity.remoteID === this.localPlayer.remoteID;

        switch (key) {
            case "yaca:megaphoneactive": {
                YaCAClientModule.setPlayersCommType(
                    isOwnPlayer ? [] : this.getPlayerByID(entity.remoteID),
                    YacaFilterEnum.MEGAPHONE,
                    typeof value !== "undefined",
                    undefined,
                    value,
                    isOwnPlayer ? CommDeviceMode.SENDER : CommDeviceMode.RECEIVER,
                    isOwnPlayer ? CommDeviceMode.RECEIVER : CommDeviceMode.SENDER
                );
                break;
            }

            case "yaca:phoneSpeaker": {
                if (isOwnPlayer) this.phoneSpeakerActive = !!value;

                if (typeof value == "undefined") {
                    this.removePhoneSpeakerFromEntity(entity);
                } else {
                    if (oldValue && value) this.removePhoneSpeakerFromEntity(entity);
                    this.setPlayerVariable(entity, "phoneCallMemberIds", Array.isArray(value) ? value : [value]);
                }
                break;
            }

            case "yaca:lipsync": {
                this.syncLipsPlayer(entity, !!value);
                break;
            }

            case "yaca:voicerange": {
                if (typeof value == "undefined") return;

                if (isOwnPlayer && !this.isPlayerMuted) this.webview.emit('webview:hud:voiceDistance', value);
                this.setPlayerVariable(entity, "range", value);
                break;
            }
        }
    }

    getPlayerByID(remoteId) {
        return YaCAClientModule.allPlayers.get(remoteId);
    }

    initRequest(dataObj) {
        if (!dataObj || !dataObj.suid || typeof dataObj.chid != "number"
            || !dataObj.deChid || !dataObj.ingameName || typeof dataObj.channelPassword == "undefined"
        ) return this.radarNotification(translations.connect_error)

        this.sendWebsocket({
            base: {"request_type": "INIT"},
            server_guid: dataObj.suid,
            ingame_name: dataObj.ingameName,
            ingame_channel: dataObj.chid,
            default_channel: dataObj.deChid,
            ingame_channel_password: dataObj.channelPassword,
            excluded_channels: [1337], // Channel ID's where users can be in while being ingame
            /**
             * default are 2 meters
             * if the value is set to -1, the player voice range is taken
             * if the value is >= 0, you can set the max muffling range before it gets completely cut off
             */
            muffling_range: 2,
            build_type: YacaBuildType.RELEASE, // 0 = Release, 1 = Debug,
            unmute_delay: 400,
            operation_mode: dataObj.useWhisper ? 1 : 0,
        });

        this.useWhisper = dataObj.useWhisper;
    }

    isPluginInitialized() {
        const inited = !!this.getPlayerByID(this.localPlayer.remoteID);

        if (!inited) this.radarNotification(translations.plugin_not_initializiaed);

        return inited;
    }

    /**
     * Sends a message to the voice plugin via websocket.
     *
     * @param {Object} msg - The message to be sent.
     */
    sendWebsocket(msg) {
        if (!this.websocket) return alt.logError("[Voice-Websocket]: No websocket created");

        if (this.websocket.readyState == 1) this.websocket.send(JSON.stringify(msg));
    }

    /**
     * Handles messages from the voice plugin.
     *
     * @param {YacaResponse} payload - The response from the voice plugin.
     */
    handleResponse(payload) {
        if (!payload) return;

        try {
            // @ts-ignore
            payload = JSON.parse(payload);
        } catch (e) {
            alt.logError("[YaCA-Websocket]: Error while parsing message: ", e);
            return;
        }

        if (payload.code === "OK") {
            if (payload.requestType === "JOIN") {
                alt.emitServerRaw("server:yaca:addPlayer", parseInt(payload.message));

                if (this.rangeInterval) {
                    alt.clearInterval(this.rangeInterval);
                    this.rangeInterval = null;
                }

                this.rangeInterval = alt.setInterval(this.calcPlayers.bind(this), 250);

                // Set radio settings on reconnect only, else on first opening
                if (this.radioInited) this.initRadioSettings();
                return;
            }

            return;
        }

        if (payload.code === "TALK_STATE" || payload.code === "MUTE_STATE") {
            this.handleTalkState(payload);
            return;
        }

        const message = translations[payload.code] ?? "Unknown error!";
        if (typeof translations[payload.code] == "undefined") alt.log(`[YaCA-Websocket]: Unknown error code: ${payload.code}`);
        if (message.length < 1) return;

        natives.beginTextCommandThefeedPost("STRING");
        natives.addTextComponentSubstringPlayerName(`Voice: ${message}`);
        natives.thefeedSetBackgroundColorForNextPost(6);
        natives.endTextCommandThefeedPostTicker(false, false);
    }

    /**
     * Synchronizes the lip movement of a player based on whether they are talking or not.
     *
     * @param {alt.Player} player - The player whose lips are to be synchronized.
     * @param {boolean} isTalking - Indicates whether the player is talking.
     */
    syncLipsPlayer(player, isTalking) {
        const animationData = lipsyncAnims[isTalking];
        natives.playFacialAnim(player, animationData.name, animationData.dict);

        this.setPlayerVariable(player, "isTalking", isTalking);
    }

    /**
     * Convert camera rotation to direction vector.
     */
    getCamDirection() {
        const rotVector = natives.getGameplayCamRot(0);
        const num = rotVector.z * 0.0174532924;
        const num2 = rotVector.x * 0.0174532924;
        const num3 = Math.abs(Math.cos(num2));

        return new alt.Vector3(
            -Math.sin(num) * num3,
            Math.cos(num) * num3,
            natives.getEntityForwardVector(this.localPlayer).z
        );
    }

    /**
     * Checks if a vehicle has an opening (like a missing roof, an open convertible roof, a broken window, or an open or damaged door).
     *
     * @param {alt.Vehicle} vehicle - The vehicle to check for openings.
     * @returns {boolean} Returns true if the vehicle has an opening, false otherwise.
     */
    vehicleHasOpening(vehicle) {
        if (!natives.doesVehicleHaveRoof(vehicle)) return true;
        if (natives.isVehicleAConvertible(vehicle, false) && natives.getConvertibleRoofState(vehicle) !== 0) return true;
        if (!natives.areAllVehicleWindowsIntact(vehicle)) return true;
        if (this.vehicleMufflingWhitelist.has(vehicle.model)) return true;

        const doors = [];
        for (let i = 0; i < 6; i++) {
            if (i === 4 || !this.hasVehicleDoor(vehicle, i)) continue;
            doors.push(i);
        }
      
        if (doors.length === 0) return true;

        for (const door of doors) {
            if (natives.getVehicleDoorAngleRatio(vehicle, door) > 0) return true;
            if (natives.isVehicleDoorDamaged(vehicle, door)) return true;
        }
      
        for (let i = 0; i < 8 /* max windows */; i++) {
            if (this.hasVehicleWindow(vehicle, i) && !natives.isVehicleWindowIntact(vehicle, i)) {
                return true;
            }
        }
      
        return false;
    }

    /**
     * Checks if the vehicle has a window.
     *
     * @param {alt.Vehicle} vehicle - The vehicle.
     * @param {number} windowId - The window ID to check.
     * @returns {boolean} - Whether the vehicle has a window.
     */
    hasVehicleWindow(vehicle, windowId) {
        switch (windowId) {
            case 0:
                return natives.getEntityBoneIndexByName(vehicle, "window_lf") !== -1;
            case 1:
                return natives.getEntityBoneIndexByName(vehicle, "window_rf") !== -1;
            case 2:
                return natives.getEntityBoneIndexByName(vehicle, "window_lr") !== -1;
            case 3:
                return natives.getEntityBoneIndexByName(vehicle, "window_rr") !== -1;
            default:
                return false;
        }
    }
  
    /**
     * Checks if the vehicle has a door.
     *
     * @param {alt.Vehicle} vehicle - The vehicle.
     * @param {number} doorId - The door ID to check.
     * @returns {boolean} - Whether the vehicle has a door.
     */
    hasVehicleDoor(vehicle, doorId) {
        switch (doorId) {
            case 0:
                return natives.getEntityBoneIndexByName(vehicle, "door_dside_f") !== -1;
            case 1:
                return natives.getEntityBoneIndexByName(vehicle, "door_pside_f") !== -1;
            case 2:
                return natives.getEntityBoneIndexByName(vehicle, "door_dside_r") !== -1;
            case 3:
                return natives.getEntityBoneIndexByName(vehicle, "door_pside_r") !== -1;
            case 4:
                return natives.getEntityBoneIndexByName(vehicle, "bonnet") !== -1;
            case 5:
                return natives.getEntityBoneIndexByName(vehicle, "boot") !== -1;
            default:
                return false;
        }
    }

    /**
     * Sets a variable for a player.
     *
     * @param {alt.Player} player - The player for whom the variable is to be set.
     * @param {string} variable - The name of the variable.
     * @param {*} value - The value to be set for the variable.
     */
    setPlayerVariable(player, variable, value) {
        if (!player?.valid) return;
    
        const currentData = this.getPlayerByID(player.remoteID);
    
        if (!currentData) YaCAClientModule.allPlayers.set(player.remoteID, {});
    
        this.getPlayerByID(player.remoteID)[variable] = value;
    }

    /**
     * Retrieves a variable for a player.
     *
     * @param {alt.Player} player - The player for whom the variable is to be retrieved.
     * @param {string} variable - The name of the variable.
     * @returns {*} Returns the value of the variable if the player and variable exist, undefined otherwise.
     */
    getPlayerVariable(player, variable) {
        if (!player?.valid) return;

        const currentData = this.getPlayerByID(player.remoteID);
        if (!currentData) return;

        return currentData[variable];
    }

    /**
     * Changes the voice range.
     *
     * @param {number} toggle - The new voice range.
     */
    changeVoiceRange(toggle) {
        if (!this.localPlayer.yacaPluginLocal.canChangeVoiceRange) return false;

        if (this.visualVoiceRangeTimeout) {
            alt.clearTimeout(this.visualVoiceRangeTimeout);
            this.visualVoiceRangeTimeout = null;
        }

        if (this.visualVoiceRangeTick) {
            alt.clearEveryTick(this.visualVoiceRangeTick);
            this.visualVoiceRangeTick = null;
        }

        this.uirange += toggle;

        if (this.uirange < 1) {
            this.uirange = 1;
        } else if (this.uirange == 5) {
            this.uirange = 4;
        } else if (this.uirange == 6) {
            this.uirange = 5;
        } else if (this.uirange == 7) {
            this.uirange = 6;
        } else if (this.uirange == 8) {
            this.uirange = 7;
        } else if (this.uirange > 8) {
            this.uirange = 8;
        }

        if (this.lastuiRange == this.uirange) return false;
        this.lastuiRange = this.uirange;

        const voiceRange = voiceRangesEnum[this.uirange] || 1;

        this.visualVoiceRangeTimeout = alt.setTimeout(() => {
            if (this.visualVoiceRangeTick) {
                alt.clearEveryTick(this.visualVoiceRangeTick);
                this.visualVoiceRangeTick = null;
            }

            this.visualVoiceRangeTimeout = null;
        }, 1000),

        this.visualVoiceRangeTick = alt.everyTick(() => {
            let pos = this.localPlayer.pos;
            natives.drawMarker(1, pos.x, pos.y, pos.z - 0.98, 0, 0, 0, 0, 0, 0, (voiceRange * 2) - 1, (voiceRange * 2) - 1, 1, 0, 255, 0, 50, false, true, 2, true, null, null, false);
        });

        alt.emitServerRaw("server:yaca:changeVoiceRange", voiceRange);

        return true;
    };

    /**
     * Checks if the communication type is valid.
     *
     * @param {string} type - The type of communication to be validated.
     * @returns {boolean} Returns true if the type is valid, false otherwise.
     */
    isCommTypeValid(type) {
        const valid = YacaFilterEnum[type];
        if (!valid) alt.logError(`[YaCA-Websocket]: Invalid commtype: ${type}`);

        return !!valid;
    }

    /**
     * Set the communication type for the given players.
     *
     * @param {alt.Player | alt.Player[]} players - The player or players for whom the communication type is to be set.
     * @param {string} type - The type of communication.
     * @param {boolean} state - The state of the communication.
     * @param {number} [channel] - The channel for the communication. Optional.
     * @param {number} [range] - The range for the communication. Optional.
     */
    static setPlayersCommType(players, type, state, channel, range, ownMode, otherPlayersMode) {
        if (!Array.isArray(players)) players = [players];

        let cids = [];
        if (typeof ownMode != "undefined") {
            cids.push({
                client_id: YaCAClientModule.getInstance().getPlayerByID(alt.Player.local.remoteID).clientId,
                mode: ownMode
            })
        }

        for (const player of players) {
            if (!player) continue;

            cids.push({
                client_id: player.clientId,
                mode: otherPlayersMode
            });
        }

        const protocol = {
            on: !!state,
            comm_type: type,
            members: cids
        }

        // @ts-ignore
        if (typeof channel !== "undefined") protocol.channel = channel;
        // @ts-ignore
        if (typeof range !== "undefined") protocol.range = range;

        YaCAClientModule.getInstance().sendWebsocket({
            base: { "request_type": "INGAME" },
            comm_device: protocol
        });
    }

    /**
     * Update the volume for a specific communication type.
     *
     * @param {string} type - The type of communication.
     * @param {number} volume - The volume to be set.
     * @param {number} channel - The channel for the communication.
     */
    setCommDeviceVolume(type, volume, channel) {
        if (!this.isCommTypeValid(type)) return;

        const protocol = {
            comm_type: type,
            volume: this.clamp(volume, 0, 1)
        }

        // @ts-ignore
        if (typeof channel !== "undefined") protocol.channel = channel;

        this.sendWebsocket({
            base: {"request_type": "INGAME"},
            comm_device_settings: protocol
        })
    }

    /**
     * Update the stereo mode for a specific communication type.
     *
     * @param {YacaFilterEnum} type - The type of communication.
     * @param {YacaStereoMode} mode - The stereo mode to be set.
     * @param {number} channel - The channel for the communication.
     */
    setCommDeviceStereomode(type, mode, channel) {
        if (!this.isCommTypeValid(type)) return;

        const protocol = {
            comm_type: type,
            output_mode: mode
        }

        // @ts-ignore
        if (typeof channel !== "undefined") protocol.channel = channel;

        this.sendWebsocket({
            base: {"request_type": "INGAME"},
            comm_device_settings: protocol
        })
    }

    /* ======================== BASIC SYSTEM ======================== */

    /**
     * Monitoring if player is connected to teamspeak.
     */
    monitorConnectstate() {
        if (this.websocket?.readyState == 0 || this.websocket?.readyState == 1) {
            if (this.messageDisplayed && this.websocket.readyState == 1) {
                this.stopMhint();
                this.messageDisplayed = false;
                this.noPluginActivated = 0;
            }
            return;
        }

        this.noPluginActivated++;

        if (!this.messageDisplayed) {
            this.mhint("Voiceplugin", translations.plugin_not_activated);
            this.messageDisplayed = true;
        }

        if (this.noPluginActivated >= 120) alt.emitServerRaw("server:yaca:noVoicePlugin")
    }

    /**
     * Handles the talk and mute state from teamspeak, displays it in UI and syncs lip to other players.
     *
     * @param {YacaResponse} payload - The response from teamspeak.
     */
    handleTalkState(payload) {
        // Update state if player is muted or not
        if (payload.code === "MUTE_STATE") {
            this.isPlayerMuted = !!parseInt(payload.message);
            this.webview.emit('webview:hud:voiceDistance', this.isPlayerMuted ? 0 : voiceRangesEnum[this.uirange]);
        }
        
        const isTalking = !this.isPlayerMuted && !!parseInt(payload.message);
        if (this.isTalking != isTalking) {
            this.isTalking = isTalking;

            this.webview.emit('webview:hud:isTalking', isTalking);

            // TODO: Deprecated if alt:V syncs the playFacialAnim native
            alt.emitServerRaw("server:yaca:lipsync", isTalking)
        }
    }

    /**
     * Calculate the players in streamingrange and send them to the voiceplugin.
     */
    calcPlayers() {
        const players = new Map();
        const allPlayers = alt.Player.streamedIn;
        const localPos = this.localPlayer.pos;
        const localVehicle = this.localPlayer.vehicle;
        const currentRoom = natives.getRoomKeyFromEntity(this.localPlayer);
        const playersToPhoneSpeaker = new Set();
        const playersOnPhoneSpeaker = new Set();

        const localData = this.getPlayerByID(this.localPlayer.remoteID);
        if (!localData) return;
        
        for (const player of allPlayers) {
            if (!player?.valid || player.remoteID == this.localPlayer.remoteID) continue;

            const voiceSetting = this.getPlayerByID(player.remoteID);
            if (!voiceSetting?.clientId) continue;

            let muffleIntensity = 0;
            if (currentRoom != natives.getRoomKeyFromEntity(player) && !natives.hasEntityClearLosToEntity(this.localPlayer, player, 17)) {
                muffleIntensity = 10; // 10 is the maximum intensity
            } else if (localVehicle != player.vehicle && !player.hasStreamSyncedMeta("yaca:megaphoneactive")) {
                if (localVehicle?.valid && !this.vehicleHasOpening(localVehicle)) muffleIntensity += 3;
                if (player.vehicle?.valid && !this.vehicleHasOpening(player.vehicle)) muffleIntensity += 3;
            }

            if (!playersOnPhoneSpeaker.has(voiceSetting.remoteID)) {
                players.set(voiceSetting.remoteID, {
                    client_id: voiceSetting.clientId,
                    position: player.pos,
                    direction: natives.getEntityForwardVector(player),
                    range: voiceSetting.range,
                    is_underwater: natives.isPedSwimmingUnderWater(player),
                    muffle_intensity: muffleIntensity,
                    is_muted: voiceSetting.forceMuted
                });
            }

            
            // Phone speaker handling - user who enabled it.
            if (this.useWhisper && this.phoneSpeakerActive && this.inCall.size && localPos.distanceTo(player.pos) <= settings.maxPhoneSpeakerRange) {
                playersToPhoneSpeaker.add(player.remoteID);
            }
    
            // Phone speaker handling.
            if (voiceSetting.phoneCallMemberIds && localPos.distanceTo(player.pos) <= settings.maxPhoneSpeakerRange)
            {
                for (const phoneCallMemberId of voiceSetting.phoneCallMemberIds)
                {
                    let phoneCallMember = this.getPlayerByID(phoneCallMemberId);
                    if (!phoneCallMember || phoneCallMember.mutedOnPhone || phoneCallMember.forceMuted) continue;

                    players.delete(phoneCallMemberId);
                    players.set(phoneCallMemberId, {
                        client_id: phoneCallMember.clientId,
                        position: player.pos,
                        direction: natives.getEntityForwardVector(player),
                        range: settings.maxPhoneSpeakerRange,
                        is_underwater: natives.isPedSwimmingUnderWater(player),
                        muffle_intensity: muffleIntensity,
                        is_muted: false
                    });

                    playersOnPhoneSpeaker.add(phoneCallMemberId);

                    YaCAClientModule.setPlayersCommType(phoneCallMember, YacaFilterEnum.PHONE_SPEAKER, true, undefined, settings.maxPhoneSpeakerRange, CommDeviceMode.RECEIVER, CommDeviceMode.SENDER);

                    this.currentlyPhoneSpeakerApplied.add(phoneCallMemberId);
                }
            }
        }

        if (this.useWhisper && ((this.phoneSpeakerActive && this.inCall.size) || ((!this.phoneSpeakerActive || !this.inCall.size) && this.currentlySendingPhoneSpeakerSender.size))) {
            const playersToNotReceivePhoneSpeaker = [...this.currentlySendingPhoneSpeakerSender].filter(playerId => !playersToPhoneSpeaker.has(playerId));
            const playersNeedsReceivePhoneSpeaker = [...playersToPhoneSpeaker].filter(playerId => !this.currentlySendingPhoneSpeakerSender.has(playerId));

            this.currentlySendingPhoneSpeakerSender = new Set(playersToPhoneSpeaker);

            if (playersToNotReceivePhoneSpeaker.length || playersNeedsReceivePhoneSpeaker.length) {
                TriggerServer("server:yaca:phoneSpeakerEmit", playersNeedsReceivePhoneSpeaker, playersToNotReceivePhoneSpeaker);
            }
        }

        this.currentlyPhoneSpeakerApplied.forEach((playerId) => {
            if (!playersOnPhoneSpeaker.has(playerId)) {
                this.currentlyPhoneSpeakerApplied.delete(playerId);
                YaCAClientModule.setPlayersCommType(this.getPlayerByID(playerId), YacaFilterEnum.PHONE_SPEAKER, false, undefined, settings.maxPhoneSpeakerRange, CommDeviceMode.RECEIVER, CommDeviceMode.SENDER);
            }
        });

        /** Send collected data to ts-plugin. */
        this.sendWebsocket({
            base: {"request_type": "INGAME"},
            player: {
                player_direction: this.getCamDirection(),
                player_position: localPos,
                player_range: localData.range,
                player_is_underwater: natives.isPedSwimmingUnderWater(this.localPlayer),
                player_is_muted: localData.forceMuted,
                players_list: Array.from(players.values())
            }
        });
    }

    /* ======================== RADIO SYSTEM ======================== */
    openRadio() {
        if (!this.radioToggle && !alt.isCursorVisible()) {
            this.radioToggle = true;
            alt.showCursor(true);
            alt.toggleGameControls(false);
            this.webview.emit('webview:yaca:openState', true);
            this.webview.focus();
        } else if (this.radioToggle) {
            this.closeRadio();
        }
    }

    /**
     * Cleanup different things, if player closes his radio.
     */
    closeRadio() {
        if (!this.radioToggle) return;

        this.radioToggle = false;

        alt.showCursor(false);
        alt.toggleGameControls(true);
        this.webview.emit('webview:yaca:openState', false);
        this.webview.unfocus();
    }

    /**
     * Set volume & stereo mode for all radio channels on first start and reconnect.
     */
    initRadioSettings() {
        for (let i = 1; i <= settings.maxRadioChannels; i++) {
            if (!this.radioChannelSettings[i]) this.radioChannelSettings[i] = Object.assign({}, defaultRadioChannelSettings);
            if (!this.playersInRadioChannel.has(i)) this.playersInRadioChannel.set(i, new Set());

            const volume = this.radioChannelSettings[i].volume;
            const stereo = this.radioChannelSettings[i].stereo;

            this.setCommDeviceStereomode(YacaFilterEnum.RADIO, stereo, i);
            this.setCommDeviceVolume(YacaFilterEnum.RADIO, volume, i);
        }
    }

    /**
     * Sends an event to the plugin when a player starts or stops talking on the radio.
     *
     * @param {boolean} state - The state of the player talking on the radio.
     */
    radioTalkingStateToPlugin(state) {
        YaCAClientModule.setPlayersCommType(this.getPlayerByID(this.localPlayer.remoteID), YacaFilterEnum.RADIO, state, this.activeRadioChannel);
    }

    radioTalkingStateToPluginWithWhisper(state, targets) {
        let comDeviceTargets = [];
        for (const target of targets) {
            const player = this.getPlayerByID(target);
            if (!player) continue;

            comDeviceTargets.push(player);
        }
            
        YaCAClientModule.setPlayersCommType(comDeviceTargets, YacaFilterEnum.RADIO, state, this.activeRadioChannel, undefined, CommDeviceMode.SENDER, CommDeviceMode.RECEIVER);
    }

    /**
     * Updates the UI when a player changes the radio channel.
     *
     * @param {number} channel - The new radio channel.
     */
    updateRadioInWebview(channel) {
        if (channel != this.activeRadioChannel) return;

        this.webview.emit("webview:yaca:setChannelData", this.radioChannelSettings[channel]);
    }

    /**
     * Finds a radio channel by a given frequency.
     *
     * @param {string} frequency - The frequency to search for.
     * @returns {number | undefined} The channel number if found, undefined otherwise.
     */
    findRadioChannelByFrequency(frequency) {
        let foundChannel;
        for (const channel in this.radioChannelSettings) {
            const data = this.radioChannelSettings[channel];
            if (data.frequency == frequency) {
                foundChannel = parseInt(channel);
                break;
            }
        }

        return foundChannel;
    }

    setRadioFrequency(channel, frequency) {
        this.radioFrequenceSetted = true;

        if (this.radioChannelSettings[channel].frequency != frequency) {
            this.disableRadioFromPlayerInChannel(channel);
        }

        this.radioChannelSettings[channel].frequency = frequency;
    }

    /**
     * Disable radio effect for all players in the given channel.
     *
     * @param {number} channel - The channel number.
     */
    disableRadioFromPlayerInChannel(channel) {
        if (!this.playersInRadioChannel.has(channel)) return;

        const players = this.playersInRadioChannel.get(channel);
        if (!players?.size) return;

        let targets = [];
        for (const playerId of players) {
            const player = this.getPlayerByID(playerId);
            if (!player) continue;

            targets.push(player);
            players.delete(player.remoteID);
        }

        if (targets.length) YaCAClientModule.setPlayersCommType(targets, YacaFilterEnum.RADIO, false, channel, undefined, CommDeviceMode.RECEIVER, CommDeviceMode.SENDER);
    }

    /**
     * Starts the radio talking state.
     *
     * @param {boolean} state - The state of the radio talking.
     * @param {boolean} [clearPedTasks=true] - Whether to clear ped tasks. Defaults to true if not provided.
     */
    radioTalkingStart(state, clearPedTasks = true) {
        if (!state) {
            if (this.radioTalking) {
                this.radioTalking = false;
                if (!this.useWhisper) this.radioTalkingStateToPlugin(false);
                alt.emitServerRaw("server:yaca:radioTalking", false);
                if (clearPedTasks) natives.stopAnimTask(this.localPlayer, "random@arrests", "generic_radio_chatter", 4);
            }

            return;
        }

        if (!this.radioEnabled || !this.radioFrequenceSetted || this.radioTalking || this.localPlayer.isReloading) return;

        this.radioTalking = true;
        if (!this.useWhisper) this.radioTalkingStateToPlugin(true);

        alt.Utils.requestAnimDict("random@arrests").then(() => {
            natives.taskPlayAnim(this.localPlayer, "random@arrests", "generic_radio_chatter", 3, -4, -1, 49, 0.0, false, false, false);

            alt.emitServerRaw("server:yaca:radioTalking", true);
        });
    };

    /* ======================== PHONE SYSTEM ======================== */

    /**
     * Removes the phone speaker effect from a player entity.
     *
     * @param {alt.Player} entity - The player entity from which the phone speaker effect is to be removed.
     */
    removePhoneSpeakerFromEntity(entity) {
        if (!entity?.valid) return;

        const entityData = this.getPlayerByID(entity.remoteID);
        if (!entityData?.phoneCallMemberIds) return;

        let playersToSet = [];
        for (const phoneCallMemberId of entityData.phoneCallMemberIds) {
            let phoneCallMember = this.getPlayerByID(phoneCallMemberId);
            if (!phoneCallMember) continue;

            playersToSet.push(phoneCallMember);
        }

        YaCAClientModule.setPlayersCommType(playersToSet, YacaFilterEnum.PHONE_SPEAKER, false);
    
        delete entityData.phoneCallMemberIds;
    }

    enablePhoneCall(targetIDs, state, filter = YacaFilterEnum.PHONE) {
        if (!targetIDs.length) return;

        let targets = [];
        for (const targetID of targetIDs) {
            if (!state) this.inCall.delete(targetID);

            const target = this.getPlayerByID(targetID);
            if (!target) continue;

            targets.push(target);
            if (state) this.inCall.add(targetID);
        }

        YaCAClientModule.setPlayersCommType(targets, filter, state, undefined, undefined, CommDeviceMode.TRANSCEIVER, CommDeviceMode.TRANSCEIVER);
    }

    /* ======================== MEGAPHONE SYSTEM ======================== */
    /**
     * Toggles the use of the megaphone.
     *
     * @param {boolean} [state=false] - The state of the megaphone. Defaults to false if not provided.
     */
    useMegaphone(state = false) {
        if ((!this.localPlayer.vehicle?.valid && !this.localPlayer.yacaPluginLocal.canUseMegaphone) || state == this.localPlayer.yacaPluginLocal.lastMegaphoneState) return;

        this.localPlayer.yacaPluginLocal.lastMegaphoneState = !this.localPlayer.yacaPluginLocal.lastMegaphoneState;
        alt.emitServerRaw("server:yaca:useMegaphone", state)
    }
}
