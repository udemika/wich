/**
 * Flick Alpha — Lampa Online Plugin
 * Smart Multi-Server Lampac Client with RCH support
 */
(function () {
  'use strict';

  // ============================================================
  // POLYFILLS (for old Tizen/WebOS)
  // ============================================================
  if (!Array.prototype.find) {
    Array.prototype.find = function (cb) {
      for (var i = 0; i < this.length; i++) if (cb(this[i], i, this)) return this[i];
    };
  }
  if (!Array.prototype.findIndex) {
    Array.prototype.findIndex = function (cb) {
      for (var i = 0; i < this.length; i++) if (cb(this[i], i, this)) return i;
      return -1;
    };
  }

  // ============================================================
  // CONFIG
  // ============================================================
  var PLUGIN_NAME    = 'Flick';
  var PLUGIN_VERSION = 'Alpha';
  var COMPONENT_ID   = 'flick';
  var STORAGE_UID    = 'flick_uid';
  var STORAGE_SERVER = 'flick_server';
  var STORAGE_CUSTOM = 'flick_custom_server';

  var DEFAULT_SERVERS = [
    // Публичные серверы — работают без VPN
    'http://z01.online',
    'https://rc.bwa.ad',
    // Серверы lampa.tv — требуют VPN в России
    'https://s1.lampa.tv',
    'https://s2.lampa.tv',
    'https://s3.lampa.tv',
    'https://s4.lampa.tv',
    'https://s5.lampa.tv',
    'https://s6.lampa.tv',
    'https://s7.lampa.tv',
    'https://s8.lampa.tv',
    'https://s9.lampa.tv',
    'https://s10.lampa.tv',
    'https://lampac.lampa.tv',
    'https://lp2.lampa.tv',
    'https://lp3.lampa.tv',
    'https://lp4.lampa.tv',
    'https://lp5.lampa.tv',
    'https://lp6.lampa.tv',
    'https://lp7.lampa.tv',
    'https://lp8.lampa.tv'
  ];

  // ============================================================
  // DEFINED — динамический localhost (устанавливается ServerManager)
  // ============================================================
  var Defined = {
    localhost: 'http://z01.online/'
  };

  // ============================================================
  // RCH — WebSocket прокси для серверов lampa.tv
  // Серверы lampa.tv требуют RCH (rchtype=web → {"rch":true})
  // На Tizen/Android работает напрямую (rchtype=cors/apk)
  // ============================================================
  var hostkey = '';

  function getAndroidVersion() {
    try {
      var ua = navigator.userAgent;
      var m = ua.match(/Android\s([\d.]+)/);
      return m ? parseFloat(m[1]) : 0;
    } catch(e) { return 0; }
  }

  function initRch(serverUrl) {
    hostkey = serverUrl.replace('http://', '').replace('https://', '').replace(/\/+$/, '');
    if (!window.rch_nws) window.rch_nws = {};
    if (window.rch_nws[hostkey] && window.rch_nws[hostkey].startTypeInvoke) return;
    if (!window.rch_nws[hostkey]) {
      window.rch_nws[hostkey] = {
        type: Lampa.Platform.is('android') ? 'apk' : Lampa.Platform.is('tizen') ? 'cors' : undefined,
        startTypeInvoke: false,
        rchRegistry: false,
        connectionId: '',
        apkVersion: getAndroidVersion()
      };
    }

    window.rch_nws[hostkey].typeInvoke = function (host, call) {
      if (!window.rch_nws[hostkey].startTypeInvoke) {
        window.rch_nws[hostkey].startTypeInvoke = true;
        var check = function (good) {
          window.rch_nws[hostkey].type = Lampa.Platform.is('android') ? 'apk' : good ? 'cors' : 'web';
          call();
        };
        if (Lampa.Platform.is('android') || Lampa.Platform.is('tizen')) {
          check(true);
        } else {
          var net = new Lampa.Reguest();
          net.timeout(3000);
          net.silent(host + '/cors/check', function () { check(true); }, function () { check(false); }, false, { dataType: 'text' });
        }
      } else { call(); }
    };

    window.rch_nws[hostkey].Registry = function (client, startConnection) {
      window.rch_nws[hostkey].typeInvoke(serverUrl, function () {
        client.invoke('RchRegistry', {
          version: 154,
          host: location.host,
          rchtype: Lampa.Platform.is('android') ? 'apk' : Lampa.Platform.is('tizen') ? 'cors' : (window.rch_nws[hostkey].type || 'web'),
          apkVersion: Lampa.Platform.is('android') ? (window.rch_nws[hostkey].apkVersion || 0) : 0,
          player: Lampa.Storage.field('player')
        });
        if (window.rch_nws[hostkey].rchRegistry) return;
        window.rch_nws[hostkey].rchRegistry = true;
        var handled = false;
        client.on('RchRegistry', function (clientIp, connectionId, rchtype) {
          if (startConnection && !handled) { handled = true; startConnection(); }
        });
        client.on('RchClient', function (rchId, url, data, headers, returnHeaders) {
          var net2 = new Lampa.Reguest();
          function sendResult(uri, html) {
            $.ajax({ url: serverUrl + '/rch/' + uri + '?id=' + rchId, type: 'POST', data: html, async: true, cache: false, contentType: false, processData: false, success: function(){}, error: function(){ client.invoke('RchResult', rchId, ''); } });
          }
          function result(html) {
            if (Lampa.Arrays.isObject(html) || Lampa.Arrays.isArray(html)) html = JSON.stringify(html);
            sendResult('result', html);
          }
          if (url === 'eval') { result(eval(data)); }
          else if (url === 'evalrun') { eval(data); }
          else if (url === 'ping') { result('pong'); }
          else {
            net2['native'](url, result, function (e) { result(''); }, data, { dataType: 'text', timeout: 8000, headers: headers, returnHeaders: returnHeaders });
          }
        });
        client.on('Connected', function (connectionId) {
          window.rch_nws[hostkey].connectionId = connectionId;
        });
        client.on('Closed', function () {});
        client.on('Error', function (err) { console.log('[Flick] RCH error:', err); });
      });
    };

    window.rch_nws[hostkey].typeInvoke(serverUrl, function () {});
  }

  function rchInvoke(json, call) {
    // Если уже подключён и переподключается — просто вызываем
    if (window.nwsClient && window.nwsClient[hostkey] && window.nwsClient[hostkey]._shouldReconnect) {
      call();
      return;
    }
    if (!window.nwsClient) window.nwsClient = {};
    // Закрываем старый сокет если есть
    if (window.nwsClient[hostkey] && window.nwsClient[hostkey].socket) {
      window.nwsClient[hostkey].socket.close();
    }
    window.nwsClient[hostkey] = new NativeWsClient(json.nws, { autoReconnect: false });
    window.nwsClient[hostkey].on('Connected', function () {
      window.rch_nws[hostkey].Registry(window.nwsClient[hostkey], function () { call(); });
    });
    window.nwsClient[hostkey].connect();
  }

  function rchRun(json, call) {
    if (typeof NativeWsClient === 'undefined') {
      // Загружаем NativeWsClient с сервера lampa.tv
      var nwsUrl = (Defined.localhost || 'https://s1.lampa.tv/').replace(/\/+$/, '') + '/js/nws-client-es5.js';
      Lampa.Utils.putScript([nwsUrl], function () {}, false, function () {
        rchInvoke(json, call);
      }, true);
    } else {
      rchInvoke(json, call);
    }
  }

  // ============================================================
  // ACCOUNT — добавление параметров к URL
  // Используем lampac_unic_id — стандартный ключ для серверов lampa.tv
  // ============================================================
  function account(url) {
    url = url + '';
    if (url.indexOf('account_email=') === -1) {
      var email = Lampa.Storage.get('account_email');
      if (email) url = Lampa.Utils.addUrlComponent(url, 'account_email=' + encodeURIComponent(email));
    }
    if (url.indexOf('uid=') === -1) {
      // Используем lampac_unic_id — именно этот ключ знают серверы lampa.tv
      var uid = Lampa.Storage.get('lampac_unic_id', '');
      if (uid) url = Lampa.Utils.addUrlComponent(url, 'uid=' + encodeURIComponent(uid));
    }
    if (url.indexOf('nws_id=') === -1 && window.rch_nws && window.rch_nws[hostkey]) {
      var nws_id = window.rch_nws[hostkey].connectionId || Lampa.Storage.get('lampac_nws_id', '');
      if (nws_id) url = Lampa.Utils.addUrlComponent(url, 'nws_id=' + encodeURIComponent(nws_id));
    }
    return url;
  }

  // ============================================================
  // SERVER MANAGER — выбор сервера
  // Серверы lampa.tv используют JS-редирект (антибот защита),
  // поэтому ping не работает. Просто берём сервер из списка
  // и переключаемся при ошибке.
  // ============================================================
  var ServerManager = {
    _server: '',
    _index: 0,
    _cacheKey: 'flick_active_server',
    _cacheTTL: 60 * 60 * 1000,

    /** Получить активный сервер */
    getServer: function (callback) {
      // 1. Пользовательский сервер
      var custom = (Lampa.Storage.get(STORAGE_CUSTOM, '') + '').trim();
      if (custom) {
        if (custom.indexOf('://') === -1) custom = 'https://' + custom;
        custom = custom.replace(/\/+$/, '');
        this._server = custom;
        Defined.localhost = custom + '/';
        initRch(custom);
        callback(custom);
        return;
      }

      // 2. Кэш
      if (this._server) {
        callback(this._server);
        return;
      }
      var cached = Lampa.Storage.get(this._cacheKey, '');
      var cachedTime = parseInt(Lampa.Storage.get(this._cacheKey + '_time', '0'));
      if (cached && (Date.now() - cachedTime) < this._cacheTTL) {
        this._server = cached;
        this._index = DEFAULT_SERVERS.indexOf(cached);
        if (this._index < 0) this._index = 0;
        Defined.localhost = cached + '/';
        initRch(cached);
        callback(cached);
        return;
      }

      // 3. Берём первый сервер из списка
      var server = DEFAULT_SERVERS[0];
      this._server = server;
      this._index = 0;
      Defined.localhost = server + '/';
      initRch(server);
      Lampa.Storage.set(this._cacheKey, server);
      Lampa.Storage.set(this._cacheKey + '_time', Date.now() + '');
      callback(server);
    },

    /** Сбросить кэш */
    invalidate: function () {
      this._server = '';
      this._index = 0;
      Lampa.Storage.set(this._cacheKey, '');
      Lampa.Storage.set(this._cacheKey + '_time', '0');
    },

    /** Переключиться на следующий сервер при ошибке */
    switchNext: function (currentServer, callback) {
      var idx = DEFAULT_SERVERS.indexOf(currentServer);
      var next = DEFAULT_SERVERS[idx + 1] || DEFAULT_SERVERS[0];
      this._server = next;
      this._index = DEFAULT_SERVERS.indexOf(next);
      Defined.localhost = next + '/';
      initRch(next);
      Lampa.Storage.set(this._cacheKey, next);
      Lampa.Storage.set(this._cacheKey + '_time', Date.now() + '');
      callback(next);
    }
  };

  // ============================================================
  // HELPERS
  // ============================================================
  function parseJson(str) {
    try { return typeof str === 'object' ? str : JSON.parse(str); } catch (e) { return null; }
  }

  function getRchType() {
    if (window.rch_nws && window.rch_nws[hostkey]) return window.rch_nws[hostkey].type || '';
    return '';
  }

  function getBestQuality(quality) {
    if (!quality || typeof quality !== 'object') return '';
    var keys = Object.keys(quality);
    if (!keys.length) return '';
    // Сортируем по числу (4K > 1080 > 720 > 480)
    keys.sort(function (a, b) {
      return (parseInt(b) || 0) - (parseInt(a) || 0);
    });
    return keys[0];
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) { return dateStr; }
  }

  // ============================================================
  // COMPONENT — основной компонент
  // ============================================================
  function FlickComponent(object) {
    var network = new Lampa.Reguest();
    var scroll  = new Lampa.Scroll({ mask: true, over: true });
    var files   = new Lampa.Explorer(object);
    var filter  = new Lampa.Filter(object);
    var sources = {};
    var last, source, balanser, initialized;
    var balanser_timer;
    var images = [];
    var request_count = 0;
    var request_timer;
    var life_wait_times = 0;
    var life_wait_timer;
    var filter_sources = [];
    var filter_find = { season: [], voice: [] };
    var memkey = '';
    var currentServer = '';

    var filter_translate = {
      season: Lampa.Lang.translate('torrent_serial_season'),
      voice:  Lampa.Lang.translate('torrent_parser_voice'),
      source: Lampa.Lang.translate('settings_rest_source')
    };

    // --- Clarification ---
    function clarificationId() {
      return Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
    }
    function clarificationAdd(value) {
      var all = parseJson(Lampa.Storage.get('clarification_search', '{}')) || {};
      all[clarificationId()] = value;
      Lampa.Storage.set('clarification_search', JSON.stringify(all));
    }
    function clarificationDelete() {
      var all = parseJson(Lampa.Storage.get('clarification_search', '{}')) || {};
      delete all[clarificationId()];
      Lampa.Storage.set('clarification_search', JSON.stringify(all));
    }

    function balanserName(j) {
      var name = j.name.split(' ')[0];
      return (j.balanser || name).toLowerCase();
    }

    // --- Request params ---
    this.requestParams = function (url) {
      var query = [];
      var card_source = object.movie.source || 'tmdb';
      query.push('id=' + encodeURIComponent(object.movie.id));
      if (object.movie.imdb_id)      query.push('imdb_id=' + (object.movie.imdb_id || ''));
      if (object.movie.kinopoisk_id) query.push('kinopoisk_id=' + (object.movie.kinopoisk_id || ''));
      if (object.movie.tmdb_id)      query.push('tmdb_id=' + (object.movie.tmdb_id || ''));
      if (object.movie.keywords && object.movie.keywords.results) {
        for (var i = 0, a = object.movie.keywords.results; i < a.length; i++) {
          if (a[i].name === 'anime') { query.push('anime=1'); break; }
        }
      }
      query.push('title=' + encodeURIComponent(object.clarification ? object.search : (object.movie.title || object.movie.name)));
      query.push('original_title=' + encodeURIComponent(object.movie.original_title || object.movie.original_name || ''));
      query.push('serial=' + (object.movie.name ? 1 : 0));
      query.push('original_language=' + (object.movie.original_language || ''));
      query.push('year=' + ((object.movie.release_date || object.movie.first_air_date || '0000') + '').slice(0, 4));
      query.push('source=' + card_source);
      query.push('clarification=' + (object.clarification ? 1 : 0));
      query.push('similar=' + (object.similar ? 'true' : 'false'));
      query.push('rchtype=' + getRchType());
      if (Lampa.Storage.get('account_email', '')) {
        query.push('cub_id=' + Lampa.Utils.hash(Lampa.Storage.get('account_email', '')));
      }
      return url + (url.indexOf('?') >= 0 ? '&' : '?') + query.join('&');
    };


    // --- Balanser tracking ---
    this.updateBalanser = function (name) {
      var last_select = Lampa.Storage.cache('online_last_balanser', 3000, {});
      last_select[object.movie.id] = name;
      Lampa.Storage.set('online_last_balanser', last_select);
    };

    this.changeBalanser = function (name) {
      this.updateBalanser(name);
      Lampa.Storage.set('online_balanser', name);
      var to = this.getChoice(name);
      var from = this.getChoice();
      if (from.voice_name) to.voice_name = from.voice_name;
      this.saveChoice(to, name);
      Lampa.Activity.replace();
    };

    this.getLastChoiceBalanser = function () {
      var last_select = Lampa.Storage.cache('online_last_balanser', 3000, {});
      return last_select[object.movie.id] || Lampa.Storage.get('online_balanser', filter_sources.length ? filter_sources[0] : '');
    };

    // --- startSource ---
    this.startSource = function (json) {
      return new Promise(function (resolve, reject) {
        json.forEach(function (j) {
          var name = balanserName(j);
          sources[name] = { url: j.url, name: j.name, show: typeof j.show === 'undefined' ? true : j.show };
        });
        filter_sources = Lampa.Arrays.getKeys(sources);
        if (filter_sources.length) {
          var last_select = Lampa.Storage.cache('online_last_balanser', 3000, {});
          balanser = last_select[object.movie.id] || Lampa.Storage.get('online_balanser', filter_sources[0]);
          if (!sources[balanser]) balanser = filter_sources[0];
          if (!sources[balanser].show && !object.flick_custom_select) balanser = filter_sources[0];
          source = sources[balanser].url;
          Lampa.Storage.set('active_balanser', balanser);
          resolve(json);
        } else {
          reject();
        }
      });
    };

    // --- lifeSource ---
    this.lifeSource = function () {
      var _this = this;
      return new Promise(function (resolve, reject) {
        var url = _this.requestParams(Defined.localhost + 'lifeevents?memkey=' + (memkey || ''));
        var resolved = false;

        var fin = function () {
          network.timeout(3000);
          network.silent(account(url), function (json) {
            life_wait_times++;
            filter_sources = [];
            sources = {};
            json.online.forEach(function (j) {
              var name = balanserName(j);
              sources[name] = { url: j.url, name: j.name, show: typeof j.show === 'undefined' ? true : j.show };
            });
            filter_sources = Lampa.Arrays.getKeys(sources);
            filter.set('sort', filter_sources.map(function (e) {
              return { title: sources[e].name, source: e, selected: e === balanser, ghost: !sources[e].show };
            }));
            filter.chosen('sort', [sources[balanser] ? sources[balanser].name : balanser]);

            var lastb = _this.getLastChoiceBalanser();
            var hasPreferred = json.online.some(function (c) { return c.show && balanserName(c) === lastb; });

            if (!resolved && hasPreferred) {
              resolved = true;
              resolve(json.online.filter(function (c) { return c.show; }));
            } else if (life_wait_times > 15 || json.ready) {
              filter.render().find('.flick-balanser-loader').remove();
              if (!resolved) {
                var any = json.online.filter(function (c) { return c.show; });
                if (any.length) { resolved = true; resolve(any); } else reject();
              }
            } else {
              life_wait_timer = setTimeout(fin, 1000);
            }
          }, function () {
            life_wait_times++;
            if (life_wait_times > 15) reject();
            else life_wait_timer = setTimeout(fin, 1000);
          });
        };
        fin();
      });
    };

    // --- createSource ---
    this.createSource = function () {
      var _this = this;
      return new Promise(function (resolve, reject) {
        var url = _this.requestParams(Defined.localhost + 'lite/events?life=true');
        network.timeout(15000);
        network.silent(account(url), function (json) {
          if (json.accsdb) return reject(json);
          if (json.life) {
            memkey = json.memkey || '';
            if (json.title) {
              if (object.movie.name)  object.movie.name  = json.title;
              if (object.movie.title) object.movie.title = json.title;
            }
            filter.render().find('.filter--sort').append(
              '<span class="flick-balanser-loader" style="width:1.2em;height:1.2em;margin-top:0;background:url(./img/loader.svg) no-repeat 50% 50%;background-size:contain;margin-left:0.5em"></span>'
            );
            _this.lifeSource().then(_this.startSource.bind(_this)).then(resolve).catch(reject);
          } else {
            _this.startSource(json).then(resolve).catch(reject);
          }
        }, reject);
      });
    };

    // --- RCH handler ---
    this.rch = function (json, noreset) {
      var _self = this;
      rchRun(json, function () {
        if (!noreset) _self.find();
        else noreset();
      });
    };

    // --- Initialize ---
    this.initialize = function () {
      var _this = this;
      this.loading(true);

      filter.onSearch = function (value) {
        clarificationAdd(value);
        Lampa.Activity.replace({ search: value, clarification: true, similar: true });
      };
      filter.onBack = function () { _this.start(); };
      filter.render().find('.selector').on('hover:enter', function () { clearInterval(balanser_timer); });
      filter.render().find('.filter--search').appendTo(filter.render().find('.torrent-filter'));

      filter.onSelect = function (type, a, b) {
        if (type === 'filter') {
          if (a.reset) {
            clarificationDelete();
            _this.replaceChoice({ season: 0, voice: 0, voice_url: '', voice_name: '' });
            setTimeout(function () { Lampa.Select.close(); Lampa.Activity.replace({ clarification: 0, similar: 0 }); }, 10);
          } else {
            var url = filter_find[a.stype][b.index].url;
            var choice = _this.getChoice();
            if (a.stype === 'voice') { choice.voice_name = filter_find.voice[b.index].title; choice.voice_url = url; }
            choice[a.stype] = b.index;
            _this.saveChoice(choice);
            _this.reset();
            _this.request(url);
            setTimeout(Lampa.Select.close, 10);
          }
        } else if (type === 'sort') {
          Lampa.Select.close();
          object.flick_custom_select = a.source;
          _this.changeBalanser(a.source);
        }
      };

      if (filter.addButtonBack) filter.addButtonBack();
      filter.render().find('.filter--sort span').text(Lampa.Lang.translate('flick_source'));
      scroll.body().addClass('torrent-list');
      files.appendFiles(scroll.render());
      files.appendHead(filter.render());
      scroll.minus(files.render().find('.explorer__files-head'));
      scroll.body().append(Lampa.Template.get('flick_loading', {}));
      Lampa.Controller.enable('content');
      this.loading(false);

      // Режим прямого балансера
      if (object.balanser) {
        files.render().find('.filter--search').remove();
        sources = {};
        sources[object.balanser] = { name: object.balanser };
        balanser = object.balanser;
        filter_sources = [];
        return network['native'](account(object.url.replace('rjson=', 'nojson=')), this.parse.bind(this), function () {
          files.render().find('.torrent-filter').remove();
          _this.empty();
        }, false, { dataType: 'text' });
      }

      // Получаем сервер, ждём определения rchtype, затем запускаем
      ServerManager.getServer(function (server) {
        currentServer = server;
        Defined.localhost = server + '/';
        initRch(server);
        // Ждём завершения typeInvoke чтобы rchtype был правильным в первом запросе
        window.rch_nws[hostkey].typeInvoke(server, function () {
          _this.createSource().then(function () {
            _this.search();
          }).catch(function (e) {
            _this.noConnectToServer(e);
          });
        });
      });
    };

    // --- Search & Request ---
    this.search = function () {
      this.filter({ source: filter_sources }, this.getChoice());
      this.find();
    };

    this.find = function () {
      this.request(this.requestParams(source));
    };

    this.request = function (url) {
      request_count++;
      if (request_count < 10) {
        network['native'](account(url), this.parse.bind(this), this.doesNotAnswer.bind(this), false, { dataType: 'text' });
        clearTimeout(request_timer);
        request_timer = setTimeout(function () { request_count = 0; }, 4000);
      } else {
        this.empty();
      }
    };

    // --- Parse items ---
    this.parseItems = function (str, selector) {
      try {
        var html  = $('<div>' + str + '</div>');
        var elems = [];
        html.find(selector).each(function () {
          var item   = $(this);
          var data   = parseJson(item.attr('data-json')) || {};
          var season = item.attr('s');
          var ep     = item.attr('e');
          var text   = item.text();
          if (!object.movie.name) {
            if (text.match(/\d+p/i)) {
              if (!data.quality) { data.quality = {}; data.quality[text] = data.url; }
              text = object.movie.title;
            }
            if (text === 'По умолчанию') text = object.movie.title;
          }
          if (ep)     data.episode = parseInt(ep);
          if (season) data.season  = parseInt(season);
          if (text)   data.text    = text;
          data.active = item.hasClass('active');
          elems.push(data);
        });
        return elems;
      } catch (e) { return []; }
    };

    // --- Parse ---
    this.parse = function (str) {
      var json = Lampa.Arrays.decodeJson(str, {});
      if (Lampa.Arrays.isObject(str) && str.rch) json = str;
      if (json.rch) return this.rch(json);

      try {
        var items   = this.parseItems(str, '.videos__item');
        var buttons = this.parseItems(str, '.videos__button');

        if (items.length === 1 && items[0].method === 'link' && !items[0].similar) {
          filter_find.season = items.map(function (s) { return { title: s.text, url: s.url }; });
          this.replaceChoice({ season: 0 });
          this.request(items[0].url);
          return;
        }

        this.activity.loader(false);
        var videos  = items.filter(function (v) { return v.method === 'play' || v.method === 'call'; });
        var similar = items.filter(function (v) { return v.similar; });

        if (videos.length) {
          if (buttons.length) {
            filter_find.voice = buttons.map(function (b) { return { title: b.text, url: b.url }; });
            var choice = this.getChoice(balanser);
            var byUrl  = buttons.find(function (v) { return v.url  === choice.voice_url; });
            var byName = buttons.find(function (v) { return v.text === choice.voice_name; });
            var active = buttons.find(function (v) { return v.active; });
            if (byUrl && !byUrl.active) {
              this.replaceChoice({ voice: buttons.indexOf(byUrl), voice_name: byUrl.text });
              this.request(byUrl.url);
            } else if (byName && !byName.active) {
              this.replaceChoice({ voice: buttons.indexOf(byName), voice_name: byName.text });
              this.request(byName.url);
            } else {
              if (active) this.replaceChoice({ voice: buttons.indexOf(active), voice_name: active.text });
              this.display(videos);
            }
          } else {
            this.replaceChoice({ voice: 0, voice_url: '', voice_name: '' });
            this.display(videos);
          }
        } else if (items.length) {
          if (similar.length) {
            this.similars(similar);
            this.activity.loader(false);
          } else {
            filter_find.season = items.map(function (s) { return { title: s.text, url: s.url }; });
            var sel_season = this.getChoice(balanser).season;
            var season = filter_find.season[sel_season] || filter_find.season[0];
            this.request(season.url);
          }
        } else {
          this.doesNotAnswer(json);
        }
      } catch (e) {
        this.doesNotAnswer(e);
      }
    };

    // --- Get file URL ---
    this.getFileUrl = function (file, callback, waiting_rch) {
      var _this = this;
      if (Lampa.Storage.field('player') !== 'inner' && file.stream && Lampa.Platform.is('apple')) {
        var f = Lampa.Arrays.clone(file);
        f.method = 'play';
        f.url = file.stream;
        callback(f, {});
        return;
      }
      if (file.method === 'play') { callback(file, {}); return; }

      Lampa.Loading.start(function () { Lampa.Loading.stop(); Lampa.Controller.toggle('content'); network.clear(); });
      network['native'](account(file.url), function (json) {
        if (json.rch) {
          if (waiting_rch) { Lampa.Loading.stop(); callback(false, {}); }
          else {
            _this.rch(json, function () {
              Lampa.Loading.stop();
              _this.getFileUrl(file, callback, true);
            });
          }
        } else {
          Lampa.Loading.stop();
          callback(json, json);
        }
      }, function () { Lampa.Loading.stop(); callback(false, {}); });
    };

    // --- Play element ---
    this.toPlayElement = function (file) {
      return {
        title:      file.title,
        url:        file.url,
        quality:    file.qualitys,
        timeline:   file.timeline,
        subtitles:  file.subtitles,
        segments:   file.segments,
        callback:   file.mark,
        season:     file.season,
        episode:    file.episode,
        voice_name: file.voice_name,
        thumbnail:  file.thumbnail
      };
    };

    this.orUrlReserve = function (data) {
      if (data.url && typeof data.url === 'string' && data.url.indexOf(' or ') !== -1) {
        var parts = data.url.split(' or ');
        data.url = parts[0];
        data.url_reserve = parts[1];
      }
    };

    this.setDefaultQuality = function (data) {
      if (Lampa.Arrays.getKeys(data.quality || {}).length) {
        for (var q in data.quality) {
          if (parseInt(q) === Lampa.Storage.field('video_quality_default')) {
            data.url = data.quality[q];
            this.orUrlReserve(data);
          }
          if (data.quality[q].indexOf(' or ') !== -1) data.quality[q] = data.quality[q].split(' or ')[0];
        }
      }
    };

    // --- Display ---
    this.display = function (videos) {
      var _this = this;
      this.draw(videos, {
        onEnter: function (item, html) {
          _this.getFileUrl(item, function (json, json_call) {
            if (json && json.url) {
              var playlist = [];
              var first = _this.toPlayElement(item);
              first.url      = json.url;
              first.headers  = json_call.headers || json.headers;
              first.quality  = json_call.quality || item.qualitys;
              first.segments = json_call.segments || item.segments;
              first.subtitles = json.subtitles;
              first.subtitles_call = json_call.subtitles_call || json.subtitles_call;
              _this.orUrlReserve(first);
              _this.setDefaultQuality(first);

              if (item.season) {
                videos.forEach(function (elem) {
                  var cell = _this.toPlayElement(elem);
                  if (elem === item) {
                    cell.url = json.url;
                  } else if (elem.method === 'call') {
                    if (Lampa.Storage.field('player') !== 'inner') {
                      cell.url = elem.stream;
                      delete cell.quality;
                    } else {
                      cell.url = function (call) {
                        _this.getFileUrl(elem, function (stream, sj) {
                          if (stream && stream.url) {
                            cell.url = stream.url;
                            cell.quality = sj.quality || elem.qualitys;
                            cell.segments = sj.segments || elem.segments;
                            cell.subtitles = stream.subtitles;
                            _this.orUrlReserve(cell);
                            _this.setDefaultQuality(cell);
                            elem.mark();
                          } else { cell.url = ''; Lampa.Noty.show(Lampa.Lang.translate('flick_nolink')); }
                          call();
                        });
                      };
                    }
                  } else {
                    cell.url = elem.url;
                  }
                  _this.orUrlReserve(cell);
                  _this.setDefaultQuality(cell);
                  playlist.push(cell);
                });
              } else {
                playlist.push(first);
              }

              if (playlist.length > 1) first.playlist = playlist;
              if (first.url) {
                first.isonline = true;
                Lampa.Player.play(first);
                Lampa.Player.playlist(playlist);
                if (first.subtitles_call) _this.loadSubtitles(first.subtitles_call);
                item.mark();
                _this.updateBalanser(balanser);
              } else {
                Lampa.Noty.show(Lampa.Lang.translate('flick_nolink'));
              }
            } else {
              Lampa.Noty.show(Lampa.Lang.translate('flick_nolink'));
            }
          });
        },
        onContextMenu: function (item, html, data, call) {
          _this.getFileUrl(item, function (stream) {
            call({ file: stream ? stream.url : '', quality: item.qualitys });
          });
        }
      });

      this.filter({
        season: filter_find.season.map(function (s) { return s.title; }),
        voice:  filter_find.voice.map(function (b) { return b.title; })
      }, this.getChoice());
    };

    this.loadSubtitles = function (link) {
      network.silent(account(link), function (subs) { Lampa.Player.subtitles(subs); }, function () {});
    };

    // --- Similars ---
    this.similars = function (json) {
      var _this = this;
      scroll.clear();
      json.forEach(function (elem) {
        var info = [];
        var year = ((elem.start_date || elem.year || object.movie.release_date || object.movie.first_air_date || '') + '').slice(0, 4);
        if (year) info.push(year);
        if (elem.details) info.push(elem.details);
        elem.title = elem.title || elem.text;
        elem.time  = elem.time || '';
        elem.info  = info.join('<span class="flick-split">●</span>');
        var item = Lampa.Template.get('flick_folder', elem);
        if (elem.img) {
          var image = $('<img style="height:7em;width:7em;border-radius:0.3em;"/>');
          item.find('.flick-folder__icon').empty().append(image);
          if (elem.img.charAt(0) === '/') elem.img = currentServer + elem.img.substring(1);
          Lampa.Utils.imgLoad(image, elem.img);
        }
        item.on('hover:enter', function () { _this.reset(); _this.request(elem.url); })
            .on('hover:focus', function (e) { last = e.target; scroll.update($(e.target), true); });
        scroll.append(item);
      });
      this.filter({
        season: filter_find.season.map(function (s) { return s.title; }),
        voice:  filter_find.voice.map(function (b) { return b.title; })
      }, this.getChoice());
      Lampa.Controller.enable('content');
    };

    // --- Choice ---
    this.getChoice = function (for_balanser) {
      var data = Lampa.Storage.cache('online_choice_' + (for_balanser || balanser), 3000, {});
      var save = data[object.movie.id] || {};
      Lampa.Arrays.extend(save, { season: 0, voice: 0, voice_name: '', voice_id: 0, episodes_view: {}, movie_view: '' });
      return save;
    };

    this.saveChoice = function (choice, for_balanser) {
      var data = Lampa.Storage.cache('online_choice_' + (for_balanser || balanser), 3000, {});
      data[object.movie.id] = choice;
      Lampa.Storage.set('online_choice_' + (for_balanser || balanser), data);
      this.updateBalanser(for_balanser || balanser);
    };

    this.replaceChoice = function (choice, for_balanser) {
      var to = this.getChoice(for_balanser);
      Lampa.Arrays.extend(to, choice, true);
      this.saveChoice(to, for_balanser);
    };

    // --- Images ---
    this.clearImages = function () {
      images.forEach(function (img) { img.onerror = function(){}; img.onload = function(){}; img.src = ''; });
      images = [];
    };

    // --- Reset ---
    this.reset = function () {
      last = false;
      clearInterval(balanser_timer);
      network.clear();
      this.clearImages();
      scroll.render().find('.empty').remove();
      scroll.clear();
      scroll.reset();
      scroll.body().append(Lampa.Template.get('flick_loading', {}));
    };

    // --- Loading ---
    this.loading = function (status) {
      if (status) this.activity.loader(true);
      else { this.activity.loader(false); this.activity.toggle(); }
    };

    // --- Filter ---
    this.filter = function (filter_items, choice) {
      var _this = this;
      var select = [];
      var addFilter = function (type, title) {
        var need = _this.getChoice();
        var items = filter_items[type];
        var value = need[type];
        var subitems = items.map(function (name, i) { return { title: name, selected: value === i, index: i }; });
        select.push({ title: title, subtitle: items[value], items: subitems, stype: type });
      };
      filter_items.source = filter_sources;
      select.push({ title: Lampa.Lang.translate('torrent_parser_reset'), reset: true });
      if (filter_items.voice  && filter_items.voice.length)  addFilter('voice',  Lampa.Lang.translate('torrent_parser_voice'));
      if (filter_items.season && filter_items.season.length) addFilter('season', Lampa.Lang.translate('torrent_serial_season'));
      filter.set('filter', select);
      filter.set('sort', filter_sources.map(function (e) {
        return { title: sources[e].name, source: e, selected: e === balanser, ghost: !sources[e].show };
      }));
      this.saveChoice(choice);
      this.selected(filter_items);
    };

    this.selected = function (filter_items) {
      var need = this.getChoice();
      var select = [];
      for (var i in need) {
        if (filter_items[i] && filter_items[i].length) {
          if (i === 'voice') select.push(filter_translate[i] + ': ' + filter_items[i][need[i]]);
          else if (i !== 'source' && filter_items.season && filter_items.season.length >= 1) select.push(filter_translate.season + ': ' + filter_items[i][need[i]]);
        }
      }
      filter.chosen('filter', select);
      if (sources[balanser]) filter.chosen('sort', [sources[balanser].name]);
    };

    // --- Episodes ---
    this.getEpisodes = function (season, callback) {
      var tmdb_id = object.movie.id;
      if (['cub', 'tmdb'].indexOf(object.movie.source || 'tmdb') === -1) tmdb_id = object.movie.tmdb_id;
      if (typeof tmdb_id === 'number' && object.movie.name) {
        Lampa.Api.sources.tmdb.get('tv/' + tmdb_id + '/season/' + season, {}, function (data) { callback(data.episodes || []); }, function () { callback([]); });
      } else { callback([]); }
    };

    // --- Watch history ---
    this.watched = function (set) {
      var file_id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
      var watched = Lampa.Storage.cache('online_watched_last', 5000, {});
      if (set) {
        if (!watched[file_id]) watched[file_id] = {};
        Lampa.Arrays.extend(watched[file_id], set, true);
        Lampa.Storage.set('online_watched_last', watched);
        this.updateWatched();
      } else { return watched[file_id]; }
    };

    this.updateWatched = function () {
      var watched = this.watched();
      var body = scroll.body().find('.flick-watched .flick-watched__body').empty();
      if (watched) {
        var line = [];
        if (watched.balanser_name) line.push(watched.balanser_name);
        if (watched.voice_name)    line.push(watched.voice_name);
        if (watched.season)  line.push(Lampa.Lang.translate('torrent_serial_season')  + ' ' + watched.season);
        if (watched.episode) line.push(Lampa.Lang.translate('torrent_serial_episode') + ' ' + watched.episode);
        line.forEach(function (n) { body.append('<span>' + n + '</span>'); });
      } else {
        body.append('<span>' + Lampa.Lang.translate('flick_no_history') + '</span>');
      }
    };

    this.getLastEpisode = function (items) {
      var last_ep = 0;
      items.forEach(function (e) { if (typeof e.episode !== 'undefined') last_ep = Math.max(last_ep, parseInt(e.episode)); });
      return last_ep;
    };

    // --- Draw ---
    this.draw = function (items, params) {
      var _this = this;
      params = params || {};
      if (!items.length) return this.empty();

      scroll.clear();
      if (!object.balanser) scroll.append(Lampa.Template.get('flick_watched', {}));
      this.updateWatched();

      this.getEpisodes(items[0] && items[0].season, function (episodes) {
        var viewed = Lampa.Storage.cache('online_view', 5000, []);
        var serial = !!object.movie.name;
        var choice = _this.getChoice();
        var fully  = window.innerWidth > 480;
        var scroll_to_elem = false;
        var scroll_to_mark = false;

        items.forEach(function (element, index) {
          var episode = serial && episodes.length ? episodes.find(function (e) { return e.episode_number === element.episode; }) : false;
          var episode_num  = element.episode || index + 1;
          var episode_last = choice.episodes_view[element.season];
          var voice_name   = choice.voice_name || (filter_find.voice[0] ? filter_find.voice[0].title : false) || element.voice_name || (serial ? 'Неизвестно' : element.text) || 'Неизвестно';

          // --- Flick: определяем качество и дату ---
          var best_quality = '';
          var file_date    = '';
          if (element.quality && typeof element.quality === 'object') {
            best_quality = getBestQuality(element.quality);
            element.qualitys = element.quality;
            element.quality  = best_quality;
          }
          if (element.date) file_date = formatDate(element.date);

          Lampa.Arrays.extend(element, {
            voice_name: voice_name,
            info:    voice_name.length > 60 ? voice_name.substr(0, 60) + '...' : voice_name,
            quality: best_quality,
            time:    Lampa.Utils.secondsToTime((episode ? episode.runtime : object.movie.runtime) * 60, true)
          });

          var hash_timeline = Lampa.Utils.hash(
            element.season
              ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title].join('')
              : object.movie.original_title
          );
          var hash_behold = Lampa.Utils.hash(
            element.season
              ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title, element.voice_name].join('')
              : object.movie.original_title + element.voice_name
          );

          if (element.season) {
            element.translate_episode_end = _this.getLastEpisode(items);
            element.translate_voice = element.voice_name;
          }
          if (element.text && !episode) element.title = element.text;
          element.timeline = Lampa.Timeline.view(hash_timeline);

          var info = [];
          if (episode) {
            element.title = episode.name;
            if (element.info.length < 30 && episode.vote_average) info.push(Lampa.Template.get('flick_rate', { rate: parseFloat(episode.vote_average + '').toFixed(1) }, true));
            if (episode.air_date && fully) info.push(Lampa.Utils.parseTime(episode.air_date).full);
          } else if (object.movie.release_date && fully) {
            info.push(Lampa.Utils.parseTime(object.movie.release_date).full);
          }
          if (!serial && object.movie.tagline && element.info.length < 30) info.push(object.movie.tagline);
          if (element.info) info.push(element.info);
          // Flick: добавляем дату файла если есть
          if (file_date) info.push('<span class="flick-file-date">📅 ' + file_date + '</span>');
          if (info.length) {
            element.info = info.map(function (i) { return '<span>' + i + '</span>'; }).join('<span class="flick-split">●</span>');
          }

          var html   = Lampa.Template.get('flick_item', element);
          var loader = html.find('.flick-item__loader');
          var image  = html.find('.flick-item__img');

          if (object.balanser) image.hide();

          if (!serial) {
            if (choice.movie_view === hash_behold) scroll_to_elem = html;
          } else if (typeof episode_last !== 'undefined' && episode_last === episode_num) {
            scroll_to_elem = html;
          }

          if (serial && !episode) {
            image.append('<div class="flick-item__ep-num">' + (element.episode || index + 1) + '</div>');
            loader.remove();
          } else if (!serial && object.movie.backdrop_path === 'undefined') {
            loader.remove();
          } else {
            var img = html.find('img')[0];
            img.onerror = function () { img.src = './img/img_broken.svg'; };
            img.onload  = function () {
              image.addClass('flick-item__img--loaded');
              loader.remove();
              if (serial) image.append('<div class="flick-item__ep-num">' + (element.episode || index + 1) + '</div>');
            };
            img.src = Lampa.TMDB.image('t/p/w300' + (episode ? episode.still_path : object.movie.backdrop_path));
            images.push(img);
            element.thumbnail = img.src;
          }

          html.find('.flick-item__timeline').append(Lampa.Timeline.render(element.timeline));

          if (viewed.indexOf(hash_behold) !== -1) {
            scroll_to_mark = html;
            html.find('.flick-item__img').append('<div class="flick-item__viewed">' + Lampa.Template.get('icon_viewed', {}, true) + '</div>');
          }

          element.mark = function () {
            viewed = Lampa.Storage.cache('online_view', 5000, []);
            if (viewed.indexOf(hash_behold) === -1) {
              viewed.push(hash_behold);
              Lampa.Storage.set('online_view', viewed);
              if (!html.find('.flick-item__viewed').length) html.find('.flick-item__img').append('<div class="flick-item__viewed">' + Lampa.Template.get('icon_viewed', {}, true) + '</div>');
            }
            choice = _this.getChoice();
            if (!serial) choice.movie_view = hash_behold;
            else choice.episodes_view[element.season] = episode_num;
            _this.saveChoice(choice);
            var vn = choice.voice_name || element.voice_name || element.title;
            if (vn.length > 30) vn = vn.slice(0, 30) + '...';
            _this.watched({ balanser: balanser, balanser_name: Lampa.Utils.capitalizeFirstLetter(sources[balanser] ? sources[balanser].name.split(' ')[0] : balanser), voice_id: choice.voice_id, voice_name: vn, episode: element.episode, season: element.season });
          };

          element.unmark = function () {
            viewed = Lampa.Storage.cache('online_view', 5000, []);
            if (viewed.indexOf(hash_behold) !== -1) {
              Lampa.Arrays.remove(viewed, hash_behold);
              Lampa.Storage.set('online_view', viewed);
              html.find('.flick-item__viewed').remove();
            }
          };

          element.timeclear = function () {
            element.timeline.percent = 0; element.timeline.time = 0; element.timeline.duration = 0;
            Lampa.Timeline.update(element.timeline);
          };

          html.on('hover:enter', function () {
            if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
            if (params.onEnter) params.onEnter(element, html, { hash_timeline: hash_timeline, hash_behold: hash_behold });
          }).on('hover:focus', function (e) {
            last = e.target;
            if (params.onFocus) params.onFocus(element, html);
            scroll.update($(e.target), true);
          });

          if (params.onRender) params.onRender(element, html);

          _this.contextMenu({
            html: html, element: element,
            onFile: function (call) { if (params.onContextMenu) params.onContextMenu(element, html, {}, call); },
            onClearAllMark: function () { items.forEach(function (e) { e.unmark(); }); },
            onClearAllTime: function () { items.forEach(function (e) { e.timeclear(); }); }
          });

          scroll.append(html);
        });

        if (scroll_to_elem)      last = scroll_to_elem[0];
        else if (scroll_to_mark) last = scroll_to_mark[0];
        Lampa.Controller.enable('content');
      });
    };

    // --- Context menu ---
    this.contextMenu = function (params) {
      params.html.on('hover:long', function () {
        function show(extra) {
          var enabled = Lampa.Controller.enabled().name;
          var menu = [];
          if (Lampa.Platform.is('webos'))   menu.push({ title: Lampa.Lang.translate('player_lauch') + ' - Webos',   player: 'webos' });
          if (Lampa.Platform.is('android')) menu.push({ title: Lampa.Lang.translate('player_lauch') + ' - Android', player: 'android' });
          menu.push({ title: Lampa.Lang.translate('player_lauch') + ' - Lampa', player: 'lampa' });
          menu.push({ title: Lampa.Lang.translate('flick_video'), separator: true });
          menu.push({ title: Lampa.Lang.translate('torrent_parser_label_title'),        mark: true });
          menu.push({ title: Lampa.Lang.translate('torrent_parser_label_cancel_title'), unmark: true });
          menu.push({ title: Lampa.Lang.translate('time_reset'), timeclear: true });
          if (extra) menu.push({ title: Lampa.Lang.translate('copy_link'), copylink: true });
          menu.push({ title: Lampa.Lang.translate('more'), separator: true });
          menu.push({ title: Lampa.Lang.translate('flick_clear_marks'),     clearallmark: true });
          menu.push({ title: Lampa.Lang.translate('flick_clear_timecodes'), timeclearall: true });

          Lampa.Select.show({
            title: Lampa.Lang.translate('title_action'),
            items: menu,
            onBack: function () { Lampa.Controller.toggle(enabled); },
            onSelect: function (a) {
              if (a.mark)         params.element.mark();
              if (a.unmark)       params.element.unmark();
              if (a.timeclear)    params.element.timeclear();
              if (a.clearallmark) params.onClearAllMark();
              if (a.timeclearall) params.onClearAllTime();
              Lampa.Controller.toggle(enabled);
              if (a.player) { Lampa.Player.runas(a.player); params.html.trigger('hover:enter'); }
              if (a.copylink && extra) {
                if (extra.quality) {
                  var qual = [];
                  for (var i in extra.quality) qual.push({ title: i, file: extra.quality[i] });
                  Lampa.Select.show({
                    title: Lampa.Lang.translate('settings_server_links'),
                    items: qual,
                    onBack: function () { Lampa.Controller.toggle(enabled); },
                    onSelect: function (b) {
                      Lampa.Utils.copyTextToClipboard(b.file, function () { Lampa.Noty.show(Lampa.Lang.translate('copy_secuses')); }, function () { Lampa.Noty.show(Lampa.Lang.translate('copy_error')); });
                    }
                  });
                } else {
                  Lampa.Utils.copyTextToClipboard(extra.file, function () { Lampa.Noty.show(Lampa.Lang.translate('copy_secuses')); }, function () { Lampa.Noty.show(Lampa.Lang.translate('copy_error')); });
                }
              }
            }
          });
        }
        params.onFile(show);
      });
    };

    // --- Empty ---
    this.empty = function () {
      var html = Lampa.Template.get('flick_empty', {});
      html.find('.flick-empty__buttons').remove();
      html.find('.flick-empty__title').text(Lampa.Lang.translate('empty_title_two'));
      html.find('.flick-empty__time').text(Lampa.Lang.translate('empty_text'));
      scroll.clear();
      scroll.append(html);
      this.loading(false);
    };

    // --- No connect ---
    this.noConnectToServer = function (er) {
      var html = Lampa.Template.get('flick_empty', {});
      html.find('.flick-empty__buttons').remove();
      html.find('.flick-empty__title').text(Lampa.Lang.translate('title_error'));
      var msg = (er && er.accsdb) ? er.msg : Lampa.Lang.translate('flick_no_server');
      html.find('.flick-empty__time').text(msg);
      scroll.clear();
      scroll.append(html);
      this.loading(false);
    };

    // --- Does not answer ---
    this.doesNotAnswer = function (er) {
      var _this = this;
      this.reset();
      var html = Lampa.Template.get('flick_no_answer', { balanser: balanser });
      if (er && er.accsdb) html.find('.flick-empty__title').html(er.msg);

      var tic = (er && er.accsdb) ? 10 : 5;
      html.find('.cancel').on('hover:enter', function () { clearInterval(balanser_timer); });
      html.find('.change').on('hover:enter', function () {
        clearInterval(balanser_timer);
        filter.render().find('.filter--sort').trigger('hover:enter');
      });
      scroll.clear();
      scroll.append(html);
      this.loading(false);

      balanser_timer = setInterval(function () {
        tic--;
        html.find('.timeout').text(tic);
        if (tic <= 0) {
          clearInterval(balanser_timer);
          var keys = Lampa.Arrays.getKeys(sources);
          var indx = keys.indexOf(balanser);
          var next = keys[indx + 1] || keys[0];
          balanser = next;
          if (Lampa.Activity.active().activity === _this.activity) _this.changeBalanser(balanser);
        }
      }, 1000);
    };

    // --- Lifecycle ---
    this.create  = function () { return this.render(); };
    this.render  = function () { return files.render(); };
    this.back    = function () { Lampa.Activity.backward(); };
    this.pause   = function () {};
    this.stop    = function () {};

    this.start = function () {
      if (Lampa.Activity.active().activity !== this.activity) return;
      if (!initialized) { initialized = true; this.initialize(); }
      Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(scroll.render(), files.render());
          Lampa.Controller.collectionFocus(last || false, scroll.render());
        },
        gone:  function () { clearTimeout(balanser_timer); },
        up:    function () { Navigator.canmove('up') ? Navigator.move('up') : Lampa.Controller.toggle('head'); },
        down:  function () { Navigator.move('down'); },
        right: function () { Navigator.canmove('right') ? Navigator.move('right') : filter.show(Lampa.Lang.translate('title_filter'), 'filter'); },
        left:  function () { Navigator.canmove('left') ? Navigator.move('left') : Lampa.Controller.toggle('menu'); },
        back:  this.back.bind(this)
      });
      Lampa.Controller.toggle('content');
    };

    this.destroy = function () {
      network.clear();
      this.clearImages();
      files.destroy();
      scroll.destroy();
      clearInterval(balanser_timer);
      clearTimeout(life_wait_timer);
    };
  }

  // ============================================================
  // SETTINGS
  // ============================================================
  function initSettings() {
    var FLICK_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 392.697 392.697" fill="currentColor"><path d="M21.837,83.419l36.496,16.678L227.72,19.886c1.229-0.592,2.002-1.846,1.98-3.209c-0.021-1.365-0.834-2.592-2.082-3.145L197.766,0.3c-0.903-0.4-1.933-0.4-2.837,0L21.873,77.036c-1.259,0.559-2.073,1.803-2.081,3.18C19.784,81.593,20.584,82.847,21.837,83.419z"/><path d="M185.689,177.261l-64.988-30.01v91.617c0,0.856-0.44,1.655-1.167,2.114c-0.406,0.257-0.869,0.386-1.333,0.386c-0.368,0-0.736-0.082-1.079-0.244l-68.874-32.625c-0.869-0.416-1.421-1.293-1.421-2.256v-92.229L6.804,95.5c-1.083-0.496-2.344-0.406-3.347,0.238c-1.002,0.645-1.608,1.754-1.608,2.944v208.744c0,1.371,0.799,2.615,2.045,3.185l178.886,81.768c0.464,0.211,0.96,0.315,1.455,0.315c0.661,0,1.318-0.188,1.892-0.555c1.002-0.645,1.608-1.754,1.608-2.945V180.445C187.735,179.076,186.936,177.831,185.689,177.261z"/><path d="M389.24,95.74c-1.002-0.644-2.264-0.732-3.347-0.238l-178.876,81.76c-1.246,0.57-2.045,1.814-2.045,3.185v208.751c0,1.191,0.606,2.302,1.608,2.945c0.572,0.367,1.23,0.555,1.892,0.555c0.495,0,0.991-0.104,1.455-0.315l178.876-81.768c1.246-0.568,2.045-1.813,2.045-3.185V98.685C390.849,97.494,390.242,96.384,389.24,95.74z"/><path d="M372.915,80.216c-0.009-1.377-0.823-2.621-2.082-3.18l-60.182-26.681c-0.938-0.418-2.013-0.399-2.938,0.045l-173.755,82.992l60.933,29.117c0.462,0.211,0.958,0.316,1.455,0.316s0.993-0.105,1.455-0.316l173.066-79.092C372.122,82.847,372.923,81.593,372.915,80.216z"/></svg>';

    // Регистрируем компонент настроек через официальный API
    // addComponent сам создаёт шаблон settings_flick
    if (Lampa.Settings.addComponent) {
      Lampa.Settings.addComponent({
        component: COMPONENT_ID,
        icon: FLICK_ICON,
        name: PLUGIN_NAME,
        before: 'more'
      });
    }

    // Обработчик открытия секции настроек
    Lampa.Settings.listener.follow('open', function (e) {
      if (e.name !== COMPONENT_ID) return;

      var cur = ServerManager._server || Lampa.Storage.get(ServerManager._cacheKey, '') || Lampa.Lang.translate('flick_server_auto');
      var customVal = (Lampa.Storage.get(STORAGE_CUSTOM, '') + '').trim();

      e.body.html(
        '<div class="settings-param selector" data-name="flick_custom_server">' +
          '<div class="settings-param__name">' + Lampa.Lang.translate('flick_custom_server') + '</div>' +
          '<div class="settings-param__value">' + (customVal || '') + '</div>' +
          '<div class="settings-param__descr">' + Lampa.Lang.translate('flick_server_hint') + '</div>' +
        '</div>' +
        '<div class="settings-param selector" data-name="flick_reset_btn">' +
          '<div class="settings-param__name">' + Lampa.Lang.translate('flick_reset_server') + '</div>' +
        '</div>' +
        '<div class="settings-param">' +
          '<div class="settings-param__name">' + Lampa.Lang.translate('flick_server_status') + '</div>' +
          '<div class="settings-param__value flick-server-status-val">' + cur + '</div>' +
        '</div>'
      );

      e.body.find('[data-name="flick_reset_btn"]').on('hover:enter', function () {
        ServerManager.invalidate();
        Lampa.Noty.show(Lampa.Lang.translate('flick_reset_server'));
        e.body.find('.flick-server-status-val').text(Lampa.Lang.translate('flick_server_auto'));
      });

      e.body.find('[data-name="flick_custom_server"]').on('hover:enter', function () {
        Lampa.Input.show({
          title: Lampa.Lang.translate('flick_custom_server'),
          placeholder: 'https://...',
          value: customVal,
          callback: function (value) {
            Lampa.Storage.set(STORAGE_CUSTOM, value);
            ServerManager.invalidate();
            e.body.find('[data-name="flick_custom_server"] .settings-param__value').text(value);
          }
        });
      });
    });
  }

  // ============================================================
  // TEMPLATES & CSS
  // ============================================================
  function registerTemplates() {
    Lampa.Template.add('flick_item',
      '<div class="flick-item selector">' +
        '<div class="flick-item__img"><img alt=""><div class="flick-item__loader"></div></div>' +
        '<div class="flick-item__body">' +
          '<div class="flick-item__head"><div class="flick-item__title">{title}</div><div class="flick-item__time">{time}</div></div>' +
          '<div class="flick-item__timeline"></div>' +
          '<div class="flick-item__footer"><div class="flick-item__info">{info}</div><div class="flick-item__quality">{quality}</div></div>' +
        '</div>' +
      '</div>'
    );
    Lampa.Template.add('flick_loading',
      '<div class="flick-loading"><div class="broadcast__scan"><div></div></div>' +
      '<div class="flick-loading__list">' +
        '<div class="flick-loading__item selector"><div class="flick-loading__ico"></div><div class="flick-loading__body"></div></div>' +
        '<div class="flick-loading__item"><div class="flick-loading__ico"></div><div class="flick-loading__body"></div></div>' +
        '<div class="flick-loading__item"><div class="flick-loading__ico"></div><div class="flick-loading__body"></div></div>' +
      '</div></div>'
    );
    Lampa.Template.add('flick_no_answer',
      '<div class="flick-empty">' +
        '<div class="flick-empty__title">#{flick_no_results}</div>' +
        '<div class="flick-empty__time">#{flick_auto_switch}</div>' +
        '<div class="flick-empty__buttons"><div class="flick-empty__btn selector cancel">#{cancel}</div><div class="flick-empty__btn selector change">#{flick_change_source}</div></div>' +
        '<div class="flick-loading__list"><div class="flick-loading__item"><div class="flick-loading__ico"></div><div class="flick-loading__body"></div></div><div class="flick-loading__item"><div class="flick-loading__ico"></div><div class="flick-loading__body"></div></div></div>' +
      '</div>'
    );
    Lampa.Template.add('flick_empty',
      '<div class="flick-empty"><div class="flick-empty__title"></div><div class="flick-empty__time"></div><div class="flick-empty__buttons"></div></div>'
    );
    Lampa.Template.add('flick_rate',
      '<div class="flick-rate"><svg width="17" height="16" viewBox="0 0 17 16" fill="none"><path d="M8.39409 0.192139L10.99 5.30994L16.7882 6.20387L12.5475 10.4277L13.5819 15.9311L8.39409 13.2425L3.20626 15.9311L4.24065 10.4277L0 6.20387L5.79819 5.30994L8.39409 0.192139Z" fill="#fff"/></svg><span>{rate}</span></div>'
    );
    Lampa.Template.add('flick_folder',
      '<div class="flick-item flick-item--folder selector">' +
        '<div class="flick-folder__icon"><svg viewBox="0 0 128 112" fill="none"><rect y="20" width="128" height="92" rx="13" fill="white"/><path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"/><rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"/></svg></div>' +
        '<div class="flick-item__body"><div class="flick-item__head"><div class="flick-item__title">{title}</div><div class="flick-item__time">{time}</div></div><div class="flick-item__footer"><div class="flick-item__info">{info}</div></div></div>' +
      '</div>'
    );
    Lampa.Template.add('flick_watched',
      '<div class="flick-watched selector"><div class="flick-watched__icon"><svg width="21" height="21" viewBox="0 0 21 21" fill="none"><circle cx="10.5" cy="10.5" r="9" stroke="currentColor" stroke-width="3"/><path d="M14.8477 10.5628L8.20312 14.399L8.20313 6.72656L14.8477 10.5628Z" fill="currentColor"/></svg></div><div class="flick-watched__body"></div></div>'
    );
  }

  function injectCSS() {
    var css =
      '.flick-item{position:relative;border-radius:.3em;background:rgba(0,0,0,.3);display:flex}' +
      '.flick-item__body{padding:1.2em;line-height:1.3;flex-grow:1;position:relative}' +
      '@media(max-width:480px){.flick-item__body{padding:.8em 1.2em}}' +
      '.flick-item__img{position:relative;width:13em;flex-shrink:0;min-height:8.2em}' +
      '.flick-item__img>img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;border-radius:.3em;opacity:0;transition:opacity .3s}' +
      '.flick-item__img--loaded>img{opacity:1}' +
      '@media(max-width:480px){.flick-item__img{width:7em;min-height:6em}}' +
      '.flick-folder__icon{padding:1em;flex-shrink:0}.flick-folder__icon>svg{width:4.4em!important;height:4.4em!important}' +
      '.flick-item__viewed{position:absolute;top:1em;left:1em;background:rgba(0,0,0,.45);border-radius:100%;padding:.25em;font-size:.76em}' +
      '.flick-item__viewed>svg{width:1.5em!important;height:1.5em!important}' +
      '.flick-item__ep-num{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:2em}' +
      '.flick-item__loader{position:absolute;top:50%;left:50%;width:2em;height:2em;margin:-1em 0 0 -1em;background:url(./img/loader.svg) no-repeat center/contain}' +
      '.flick-item__head,.flick-item__footer{display:flex;justify-content:space-between;align-items:center}' +
      '.flick-item__timeline{margin:.8em 0}.flick-item__timeline>.time-line{display:block!important}' +
      '.flick-item__title{font-size:1.7em;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}' +
      '@media(max-width:480px){.flick-item__title{font-size:1.4em}}' +
      '.flick-item__time{padding-left:2em}' +
      '.flick-item__info{display:flex;align-items:center;flex-wrap:wrap}' +
      '.flick-item__info>*{overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical}' +
      '.flick-item__quality{padding-left:1em;white-space:nowrap;font-weight:600;color:#4fc3f7}' +
      '.flick-item.focus::after{content:"";position:absolute;top:-.6em;left:-.6em;right:-.6em;bottom:-.6em;border-radius:.7em;border:.3em solid #fff;z-index:-1;pointer-events:none}' +
      '.flick-item+.flick-item{margin-top:1.5em}' +
      '.flick-item--folder .flick-item__footer{margin-top:.8em}' +
      '.flick-file-date{opacity:.7;font-size:.9em}' +
      '.flick-watched{padding:1em;display:flex;align-items:center}' +
      '.flick-watched__icon>svg{width:1.5em;height:1.5em}' +
      '.flick-watched__body{padding-left:1em;padding-top:.1em;display:flex;flex-wrap:wrap}' +
      '.flick-watched__body>span+span::before{content:" ● ";vertical-align:top;display:inline-block;margin:0 .5em}' +
      '.flick-rate{display:inline-flex;align-items:center}.flick-rate>svg{width:1.3em!important;height:1.3em!important}.flick-rate>span{font-weight:600;font-size:1.1em;padding-left:.7em}' +
      '.flick-split{font-size:.8em;margin:0 1em;flex-shrink:0}' +
      '.flick-empty{line-height:1.4}.flick-empty__title{font-size:1.8em;margin-bottom:.3em}.flick-empty__time{font-size:1.2em;font-weight:300;margin-bottom:1.6em}' +
      '.flick-empty__buttons{display:flex}.flick-empty__buttons>*+*{margin-left:1em}' +
      '.flick-empty__btn{background:rgba(0,0,0,.3);font-size:1.2em;padding:.5em 1.2em;border-radius:.2em;margin-bottom:2.4em}.flick-empty__btn.focus{background:#fff;color:#000}' +
      '.flick-loading{padding:1em}.flick-loading__list{margin-top:1em}' +
      '.flick-loading__item{background:rgba(255,255,255,.3);padding:1em;display:flex;align-items:center;border-radius:.3em}' +
      '.flick-loading__item>*{background:rgba(0,0,0,.3);border-radius:.3em}' +
      '.flick-loading__ico{width:4em;height:4em;margin-right:2.4em}.flick-loading__body{height:1.7em;width:70%}' +
      '.flick-loading__item+.flick-loading__item{margin-top:1em;opacity:.5}.flick-loading__item+.flick-loading__item+.flick-loading__item{opacity:.2}' +
      '.flick-server-status-val{font-size:.9em;opacity:.7;word-break:break-all}';

    Lampa.Template.add('flick_css', '<style>' + css + '</style>');
    $('body').append(Lampa.Template.get('flick_css', {}, true));
  }

  // ============================================================
  // LANG
  // ============================================================
  function initLang() {
    Lampa.Lang.add({
      flick_watch:          { ru: 'Смотреть онлайн',     en: 'Watch online',          uk: 'Дивитися онлайн' },
      flick_video:          { ru: 'Видео',                en: 'Video',                 uk: 'Відео' },
      flick_no_history:     { ru: 'Нет истории просмотра', en: 'No watch history',     uk: 'Немає історії перегляду' },
      flick_nolink:         { ru: 'Не удалось получить ссылку', en: 'Failed to get link', uk: 'Не вдалося отримати посилання' },
      flick_source:         { ru: 'Источник',             en: 'Source',                uk: 'Джерело' },
      flick_no_results:     { ru: 'Поиск не дал результатов', en: 'No results found',  uk: 'Пошук не дав результатів' },
      flick_auto_switch:    { ru: 'Источник будет переключён автоматически через <span class="timeout">5</span> сек.', en: 'Source will switch in <span class="timeout">5</span> sec.', uk: 'Джерело буде переключено через <span class="timeout">5</span> сек.' },
      flick_change_source:  { ru: 'Изменить источник',   en: 'Change source',          uk: 'Змінити джерело' },
      flick_no_server:      { ru: 'Не удалось подключиться к серверу', en: 'Could not connect to server', uk: 'Не вдалося підключитися до сервера' },
      flick_rch_not_supported: { ru: 'Сервер требует RCH. Переключаемся...', en: 'Server requires RCH. Switching...', uk: 'Сервер потребує RCH. Переключаємось...' },
      flick_clear_marks:    { ru: 'Очистить все метки',  en: 'Clear all marks',        uk: 'Очистити всі мітки' },
      flick_clear_timecodes:{ ru: 'Очистить все тайм-коды', en: 'Clear all timecodes', uk: 'Очистити всі тайм-коди' },
      flick_custom_server:  { ru: 'Свой Lampac-сервер',  en: 'Custom Lampac server',   uk: 'Власний Lampac-сервер' },
      flick_server_hint:    { ru: 'Оставьте пустым для автовыбора', en: 'Leave empty for auto-select', uk: 'Залиште порожнім для автовибору' },
      flick_reset_server:   { ru: 'Сбросить кэш сервера', en: 'Reset server cache',    uk: 'Скинути кеш сервера' },
      flick_server_status:  { ru: 'Текущий сервер',      en: 'Current server',         uk: 'Поточний сервер' },
      flick_server_auto:    { ru: 'Автовыбор',           en: 'Auto-select',            uk: 'Автовибір' },
      title_online:         { ru: 'Онлайн',              en: 'Online',                 uk: 'Онлайн' }
    });
  }

  // ============================================================
  // START PLUGIN
  // ============================================================
  function startPlugin() {
    window.flick_plugin = true;

    // UID — используем lampac_unic_id (стандартный ключ для серверов lampa.tv)
    var uid = Lampa.Storage.get('lampac_unic_id', '');
    if (!uid) { uid = Lampa.Utils.uid(8).toLowerCase(); Lampa.Storage.set('lampac_unic_id', uid); }

    initLang();
    injectCSS();
    registerTemplates();
    initSettings();

    var manifest = {
      type: 'video',
      version: PLUGIN_VERSION,
      name: PLUGIN_NAME,
      description: 'Онлайн просмотр фильмов и сериалов',
      component: COMPONENT_ID,
      onContextMenu: function () { return { name: Lampa.Lang.translate('flick_watch'), description: '' }; },
      onContextLauch: function (object) {
        registerTemplates();
        Lampa.Component.add(COMPONENT_ID, FlickComponent);
        var id  = Lampa.Utils.hash(object.number_of_seasons ? object.original_name : object.original_title);
        var all = parseJson(Lampa.Storage.get('clarification_search', '{}')) || {};
        Lampa.Activity.push({
          url: '', title: Lampa.Lang.translate('title_online'), component: COMPONENT_ID,
          search: all[id] ? all[id] : object.title, search_one: object.title, search_two: object.original_title,
          movie: object, page: 1, clarification: all[id] ? true : false
        });
      }
    };

    Lampa.Manifest.plugins = manifest;
    Lampa.Component.add(COMPONENT_ID, FlickComponent);

    var buttonHTML =
      '<div class="full-start__button selector view--online flick--button" data-subtitle="' + PLUGIN_NAME + ' v' + PLUGIN_VERSION + '">' +
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 392.697 392.697">' +
          '<path d="M21.837,83.419l36.496,16.678L227.72,19.886c1.229-0.592,2.002-1.846,1.98-3.209c-0.021-1.365-0.834-2.592-2.082-3.145L197.766,0.3c-0.903-0.4-1.933-0.4-2.837,0L21.873,77.036c-1.259,0.559-2.073,1.803-2.081,3.18C19.784,81.593,20.584,82.847,21.837,83.419z" fill="currentColor"/>' +
          '<path d="M185.689,177.261l-64.988-30.01v91.617c0,0.856-0.44,1.655-1.167,2.114c-0.406,0.257-0.869,0.386-1.333,0.386c-0.368,0-0.736-0.082-1.079-0.244l-68.874-32.625c-0.869-0.416-1.421-1.293-1.421-2.256v-92.229L6.804,95.5c-1.083-0.496-2.344-0.406-3.347,0.238c-1.002,0.645-1.608,1.754-1.608,2.944v208.744c0,1.371,0.799,2.615,2.045,3.185l178.886,81.768c0.464,0.211,0.96,0.315,1.455,0.315c0.661,0,1.318-0.188,1.892-0.555c1.002-0.645,1.608-1.754,1.608-2.945V180.445C187.735,179.076,186.936,177.831,185.689,177.261z" fill="currentColor"/>' +
          '<path d="M389.24,95.74c-1.002-0.644-2.264-0.732-3.347-0.238l-178.876,81.76c-1.246,0.57-2.045,1.814-2.045,3.185v208.751c0,1.191,0.606,2.302,1.608,2.945c0.572,0.367,1.23,0.555,1.892,0.555c0.495,0,0.991-0.104,1.455-0.315l178.876-81.768c1.246-0.568,2.045-1.813,2.045-3.185V98.685C390.849,97.494,390.242,96.384,389.24,95.74z" fill="currentColor"/>' +
          '<path d="M372.915,80.216c-0.009-1.377-0.823-2.621-2.082-3.18l-60.182-26.681c-0.938-0.418-2.013-0.399-2.938,0.045l-173.755,82.992l60.933,29.117c0.462,0.211,0.958,0.316,1.455,0.316s0.993-0.105,1.455-0.316l173.066-79.092C372.122,82.847,372.923,81.593,372.915,80.216z" fill="currentColor"/>' +
        '</svg>' +
        '<span>#{title_online}</span>' +
      '</div>';

    function addButton(e) {
      if (e.render.find('.flick--button').length) return;
      var btn = $(Lampa.Lang.translate(buttonHTML));
      btn.on('hover:enter', function () {
        registerTemplates();
        Lampa.Component.add(COMPONENT_ID, FlickComponent);
        var id  = Lampa.Utils.hash(e.movie.number_of_seasons ? e.movie.original_name : e.movie.original_title);
        var all = parseJson(Lampa.Storage.get('clarification_search', '{}')) || {};
        Lampa.Activity.push({
          url: '', title: Lampa.Lang.translate('title_online'), component: COMPONENT_ID,
          search: all[id] ? all[id] : e.movie.title, search_one: e.movie.title, search_two: e.movie.original_title,
          movie: e.movie, page: 1, clarification: all[id] ? true : false
        });
      });
      e.render.after(btn);
    }

    Lampa.Listener.follow('full', function (e) {
      if (e.type === 'complite') {
        addButton({ render: e.object.activity.render().find('.view--torrent'), movie: e.data.movie });
      }
    });

    try {
      if (Lampa.Activity.active().component === 'full') {
        addButton({ render: Lampa.Activity.active().activity.render().find('.view--torrent'), movie: Lampa.Activity.active().card });
      }
    } catch (e) {}

    // Sync storage
    if (Lampa.Manifest.app_digital >= 177) {
      var balansers_sync = ['filmix','filmixtv','fxapi','rezka','pizdatoehd','getstv','kinopub','zetflixdb','collaps','hdvb','kodik','bamboo','eneyida','kinoukr','uafilm','uakino','kinotochka','remux','anilibria','animedia','animego','animevost','animebesst','alloha','mirage','phantom','animelib','moonanime','vibix','fancdn','cdnvideohub','vokino','hydraflix','videasy','vidsrc','movpi','vidlink','smashystream','autoembed','pidtor','videoseed','iptvonline','veoveo','kinoflix','leproduction','vkmovie','kinogo','kinobase','asiage','geosaitebi','mikai','dreamerscast'];
      balansers_sync.forEach(function (name) { Lampa.Storage.sync('online_choice_' + name, 'object_object'); });
      Lampa.Storage.sync('online_watched_last', 'object_object');
      Lampa.Storage.sync('online_last_balanser', 'object_object');
      Lampa.Storage.sync('online_view', 'object_array');
    }

    // Предзагрузка сервера
    ServerManager.getServer(function (server) {
      console.log('[Flick v' + PLUGIN_VERSION + '] Server:', server);
    });
  }

  if (!window.flick_plugin) startPlugin();

})();
