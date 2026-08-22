// EN/RU dictionary for the whole UI. One flat table per locale, dot-namespaced
// keys. English is the fallback: a key missing from `ru` falls back to `en`
// (see I18n.t), so a gap degrades to English instead of blank UI.
//
// Not translated on purpose:
//  * brand text (MBPlanes / MB PLANES, aircraft proper nouns Cessna/Piper/Jet)
//  * CHANGELOG entries — a developer-authored technical log, and >half the text
//    volume in the app; the release-notes SCREEN chrome is translated.
//  * anything coming from the server (player names, chat lines).

export const STRINGS = {
  en: {
    // ---- HUD ----
    'hud.spd': 'SPD',
    'hud.alt': 'ALT',
    'hud.thr': 'THR',
    'hud.gear': 'GEAR',
    'hud.gear.down': 'DOWN',
    'hud.gear.up': 'UP',
    'unit.kt': 'kt',
    'unit.ft': 'ft',
    'compass.n': 'N',

    // ---- control hints ----
    'hint.free': 'WASD fly · Q/E yaw · Shift/Ctrl throttle · G gear · R reset · drag to look',
    'hint.race':
      'S/W nose · A/D roll · Q/E yaw · Shift/Ctrl throttle · SPACE fire · G gear · R respawn at gate · L lights · drag to look',
    'hint.battle':
      'S/W nose · A/D roll · Q/E yaw · Shift/Ctrl throttle · SPACE fire · stay inside the wall · shoot down the ? balloons',
    'menu.footerHint': 'WASD · QE · shift/ctrl · space · R · drag mouse to look',

    // ---- in-flight bar ----
    'bar.menu': '← MENU',
    'bar.startRace': '🏁 RACE / BATTLE',
    'bar.crashes': 'crashes',
    'audio.title': 'M to mute',
    'audio.off': '🔈 off',
    'audio.muted': '🔇 muted',
    'audio.on': '🔊 on',
    'mp.offline': 'mp: offline',
    'mp.online': 'mp: P{id} · {count} {others}',
    'mp.other.one': 'other',
    'mp.other.many': 'others',

    // ---- banners ----
    'banner.crashed': 'CRASHED — press R to respawn',
    'banner.photo': 'PHOTO MODE — P to exit · drag to orbit · scroll to zoom',

    // ---- main menu ----
    'menu.subtitle': 'fly · drift · explode · vibes',
    'menu.singleplayer': 'SINGLEPLAYER',
    'menu.multiplayer': 'MULTIPLAYER',
    'menu.namePlaceholder': 'YOUR NAME',
    'menu.start': 'Start Game',
    'menu.continue': 'Continue',
    'menu.aircraft': 'Aircraft',
    'menu.settings': 'Settings',
    'menu.notes': 'Release Notes',
    'menu.guide': 'How to Fly',
    'menu.legal': 'Privacy & Terms',
    'legal.updated': 'Last updated {date}',
    'menu.back': 'Back',
    'menu.livery': 'Livery',
    'menu.nowBoarding': 'Now boarding',

    // ---- settings ----
    'set.timeOfDay': 'Time of day',
    'set.timeMpNote': 'Time of day is synchronized across all players in multiplayer.',
    'set.graphics': 'Graphics',
    'set.viewDistance': 'View distance',
    'set.worldSeed': 'World seed',
    'set.seedLabel': 'seed:',
    'set.seedDefault': 'default',
    'set.regenerate': 'Regenerate',
    'set.seedMpNote': 'World seed is shared by everyone in multiplayer.',
    'channel.RELEASE': 'RELEASE',
    'channel.PRE-RELEASE': 'PRE-RELEASE',
    'set.language': 'Language',
    'set.guide': 'Flight guide',
    'set.guideOpen': 'Open guide',
    'set.guideHint': 'A short walkthrough of taking off, flying and landing.',

    // ---- presets (mirror config keys) ----
    'time.auto': 'Auto',
    'time.sunrise': 'Sunrise',
    'time.morning': 'Morning',
    'time.day': 'Day',
    'time.sunset': 'Sunset',
    'time.night': 'Night',
    'gfx.low': 'Low',
    'gfx.medium': 'Medium',
    'gfx.high': 'High',
    'view.short': 'Short',
    'view.medium': 'Medium',
    'view.high': 'High',
    'view.xhigh': 'Extra High',
    'view.ultra': 'Ultra',

    // ---- aircraft copy (names stay: proper nouns) ----
    'plane.cessna.description': 'Slow and forgiving. Perfect for relaxing flights.',
    'plane.cessna.tagline': 'Grandma-approved. Warning: may induce naps.',
    'plane.piper.description': 'Balanced all-rounder. The classic sim plane.',
    'plane.piper.tagline': 'Works on my machine. Should work on yours too.',
    'plane.jet.description': 'Hot fighter. Huge thrust, sharp controls.',
    'plane.jet.tagline': 'No brakes. Only regrets and afterburner.',

    // ---- livery colours (tooltips) ----
    'color.white': 'white',
    'color.red': 'red',
    'color.blue': 'blue',
    'color.yellow': 'yellow',
    'color.pink': 'pink',
    'color.green': 'green',
    'color.orange': 'orange',
    'color.purple': 'purple',
    'color.black': 'black',

    // ---- lobby ----
    'lobby.title': 'Game Lobby',
    'lobby.kicker': 'Multiplayer · Race & Battle',
    'lobby.pilots': 'Pilots',
    'lobby.voteMode': 'Vote · Mode',
    'mode.race': 'Race',
    'mode.battle': 'Battle',
    'lobby.voteAircraft': 'Vote · Aircraft',
    'lobby.voteTime': 'Vote · Time of day',
    'lobby.voteFlags': 'Vote · Flags',
    'lobby.voteDuration': 'Vote · Match length',
    'lobby.mins': '{n} MIN',
    'lobby.yourLivery': 'Your livery',
    'lobby.chat': 'Chat',
    'lobby.chatEmpty': 'Say hello 👋',
    'lobby.chatPlaceholder': 'Message…',
    'lobby.send': 'Send',
    'lobby.startNow': 'Start Now',
    'lobby.leave': 'Leave Lobby',
    'lobby.hint':
      "Everyone races the majority-voted aircraft + time on a separate course. Fly through the gold gates · SPACE shoots · don't get shot down.",
    'lobby.hintBattle':
      'Free-for-all dogfight over random terrain: most kills when the clock runs out wins. The arena shrinks — outside the wall your hull burns. Shoot down the mystery ? balloons for a random effect, good or bad, at equal odds.',
    'lobby.flags': '{n} FLAGS',
    'lobby.launching': 'Launching in {secs}s …  ({n}/{full})',
    'lobby.waitingShort': 'Waiting for players …',
    'lobby.waiting': 'Waiting for players …  ({n}/{full}) — host can start anytime',
    'lobby.count': '({n}/{full})',
    'lobby.you': ' (you)',
    'lobby.voteNote': 'Racing: {plane} · {time} · {gates} flags (majority vote)',
    'lobby.voteNoteBattle': 'Battle: {plane} · {time} · {mins} min (majority vote)',

    // ---- race ----
    'race.go': 'GO!',
    'race.finished': 'FINISHED',
    'race.gate': 'GATE',
    'race.hull': 'HULL',
    'race.title': 'RACE',
    'race.results': '🏁 RESULTS',
    'race.dnf': 'DNF',
    'race.returning': 'returning to the lobby…',

    // ---- battle (v1.1) ----
    'battle.title': 'BATTLE',
    'battle.results': '☠ RESULTS',
    'battle.zoneWarn': 'OUTSIDE THE ZONE — hull burning!',
    'battle.storm': '⛈ THE ARENA IS SHRINKING FASTER!',
    'battle.aaDeployed': '🎯 AA SITE DEPLOYED — WATCH THE GROUND!',
    'battle.plusKill': '+1 ☠',
    // Mystery-pickup effect names (revealed only on collect).
    'fx.heal': '🔧 FULL REPAIR',
    'fx.dmg2': '☠ DOUBLE DAMAGE',
    'fx.boost': '⚡ OVERDRIVE +50% THRUST',
    'fx.dmg05': '💧 PEA SHOOTER −50% DAMAGE',
    'fx.fragile': '🥚 FRAGILE HULL +50% DMG TAKEN',
    'fx.sputter': '💨 ENGINE SPUTTER — THROTTLE CAPPED',
    'fx.storm': '⛈ STORM — you sped up the arena!',
    'fx.rockets': '🚀 5 HOMING ROCKETS — hold fire to launch',
    'fx.aa': '🎯 YOU DEPLOYED AN AA SITE!',

    // ---- touch ----
    'touch.brake': 'BRK',
    'touch.fire': 'FIRE',

    // ---- flight guide ----
    'guide.title': 'How to Fly',
    'guide.step': 'Step {n} of {total}',
    'guide.next': 'Next',
    'guide.prev': 'Back',
    'guide.done': 'Got it',
    'guide.skip': 'Skip',
    'guide.replayHint': 'You can reopen this any time in Settings.',

    'guide.s1.title': 'Welcome aboard',
    'guide.s1.body':
      'This is a calm flight sim — no score, no timer, just you and a procedural world. This guide takes a minute and covers everything you need to take off, fly and land.',
    'guide.s2.title': 'Throttle & takeoff',
    'guide.s2.body':
      'Hold Shift to add throttle, Ctrl to reduce it. Roll down the runway until about 60 kt, then gently pull the nose up with S. Don’t yank it — a small, steady pull climbs best.',
    'guide.s2.keys': 'Shift — throttle up · Ctrl — throttle down · S — nose up',
    'guide.s3.title': 'Steering',
    'guide.s3.body':
      'W and S pitch the nose down and up. A and D roll (bank) the wings — this is how you turn: bank into the turn, then pull the nose up slightly. Q and E yaw the tail for fine corrections.',
    'guide.s3.keys': 'W/S — pitch · A/D — roll · Q/E — yaw',
    'guide.s4.title': 'Landing gear',
    'guide.s4.body':
      'Press G to retract the gear once you’re climbing — it cuts drag and you fly noticeably faster. Put it back down before you land.',
    'guide.s4.keys': 'G — gear up / down',
    'guide.s5.title': 'Landing',
    'guide.s5.body':
      'Ease the throttle back, keep a shallow descent and line up with the runway. Gear down, touch down around 50–60 kt, then hold Space to brake. Flat and slow beats fast and pretty.',
    'guide.s5.keys': 'Ctrl — throttle down · G — gear down · Space — brakes',
    'guide.s6.title': 'Camera & extras',
    'guide.s6.body':
      'Drag with the mouse to look around. P opens photo mode (orbit freely, scroll to zoom), L switches the landing light, M mutes the sound, and R puts you back on the runway if things go wrong.',
    'guide.s6.keys': 'drag — look · P — photo · L — lights · M — sound · R — reset',
    'guide.s7.title': 'Playing with others',
    'guide.s7.body':
      'Switch to Multiplayer in the menu, then hit RACE / BATTLE to enter the lobby. Everyone votes on the mode, aircraft and time of day. Race: fly through the gold gates in order. Battle: a free-for-all dogfight in a shrinking arena — most kills wins, and mystery ? orbs hand out random effects, good or bad. Space shoots in both.',
    'guide.s7.keys': 'Space — fire · R — respawn at the gate (race only)',
    'guide.s8.title': 'On a phone or tablet',
    'guide.s8.body':
      'Touch controls appear automatically: the left stick steers, the right slider is the throttle, and the buttons handle gear, reset and brakes. A FIRE button shows up during races.',
  },

  ru: {
    // ---- HUD ----
    'hud.spd': 'СКР',
    'hud.alt': 'ВЫС',
    'hud.thr': 'ТЯГА',
    'hud.gear': 'ШАССИ',
    'hud.gear.down': 'ВЫПУЩ',
    'hud.gear.up': 'УБРАНО',
    'unit.kt': 'уз',
    'unit.ft': 'фт',
    'compass.n': 'С',

    // ---- control hints ----
    'hint.free': 'WASD — полёт · Q/E — рыскание · Shift/Ctrl — газ · G — шасси · R — сброс · зажми мышь для обзора',
    'hint.race':
      'S/W — нос · A/D — крен · Q/E — рыскание · Shift/Ctrl — газ · SPACE — огонь · G — шасси · R — респавн у ворот · L — фары · зажми мышь для обзора',
    'hint.battle':
      'S/W — нос · A/D — крен · Q/E — рыскание · Shift/Ctrl — газ · SPACE — огонь · держись внутри стены · сбивай шары «?»',
    'menu.footerHint': 'WASD · QE · shift/ctrl · space · R · зажми мышь для обзора',

    // ---- in-flight bar ----
    'bar.menu': '← МЕНЮ',
    'bar.startRace': '🏁 ГОНКА / БОЙ',
    'bar.crashes': 'крушения',
    'audio.title': 'M — выключить звук',
    'audio.off': '🔈 выкл',
    'audio.muted': '🔇 без звука',
    'audio.on': '🔊 вкл',
    'mp.offline': 'сеть: офлайн',
    'mp.online': 'сеть: P{id} · ещё {count} {others}',
    'mp.other.one': 'игрок',
    'mp.other.few': 'игрока',
    'mp.other.many': 'игроков',

    // ---- banners ----
    'banner.crashed': 'КРУШЕНИЕ — нажми R для респавна',
    'banner.photo': 'ФОТОРЕЖИМ — P — выход · зажми мышь — облёт · колесо — зум',

    // ---- main menu ----
    'menu.subtitle': 'летай · дрифтуй · взрывайся · кайфуй',
    'menu.singleplayer': 'ОДИНОЧНАЯ ИГРА',
    'menu.multiplayer': 'МУЛЬТИПЛЕЕР',
    'menu.namePlaceholder': 'ТВОЁ ИМЯ',
    'menu.start': 'Начать игру',
    'menu.continue': 'Продолжить',
    'menu.aircraft': 'Самолёты',
    'menu.settings': 'Настройки',
    'menu.notes': 'Что нового',
    'menu.guide': 'Как летать',
    'menu.legal': 'Данные и правила',
    'legal.updated': 'Обновлено {date}',
    'menu.back': 'Назад',
    'menu.livery': 'Окраска',
    'menu.nowBoarding': 'Посадка на борт',

    // ---- settings ----
    'set.timeOfDay': 'Время суток',
    'set.timeMpNote': 'В сетевой игре время суток синхронизировано для всех игроков.',
    'set.graphics': 'Графика',
    'set.viewDistance': 'Дальность прорисовки',
    'set.worldSeed': 'Сид мира',
    'set.seedLabel': 'сид:',
    'set.seedDefault': 'стандартный',
    'set.regenerate': 'Сгенерировать',
    'set.seedMpNote': 'В сетевой игре сид мира общий для всех.',
    'channel.RELEASE': 'РЕЛИЗ',
    'channel.PRE-RELEASE': 'ПРЕДРЕЛИЗ',
    'set.language': 'Язык',
    'set.guide': 'Обучение',
    'set.guideOpen': 'Открыть гайд',
    'set.guideHint': 'Короткий разбор: как взлететь, лететь и сесть.',

    // ---- presets ----
    'time.auto': 'Авто',
    'time.sunrise': 'Рассвет',
    'time.morning': 'Утро',
    'time.day': 'День',
    'time.sunset': 'Закат',
    'time.night': 'Ночь',
    'gfx.low': 'Низкая',
    'gfx.medium': 'Средняя',
    'gfx.high': 'Высокая',
    'view.short': 'Близко',
    'view.medium': 'Средне',
    'view.high': 'Далеко',
    'view.xhigh': 'Очень далеко',
    'view.ultra': 'Ультра',

    // ---- aircraft copy ----
    'plane.cessna.description': 'Медленный и послушный. Идеален для спокойных полётов.',
    'plane.cessna.tagline': 'Одобрено бабушкой. Осторожно: клонит в сон.',
    'plane.piper.description': 'Сбалансированный универсал. Классика симуляторов.',
    'plane.piper.tagline': 'На моей машине работает. У тебя тоже должен.',
    'plane.jet.description': 'Злой истребитель. Огромная тяга, острое управление.',
    'plane.jet.tagline': 'Без тормозов. Только сожаления и форсаж.',

    // ---- livery colours ----
    'color.white': 'белый',
    'color.red': 'красный',
    'color.blue': 'синий',
    'color.yellow': 'жёлтый',
    'color.pink': 'розовый',
    'color.green': 'зелёный',
    'color.orange': 'оранжевый',
    'color.purple': 'фиолетовый',
    'color.black': 'чёрный',

    // ---- lobby ----
    'lobby.title': 'Лобби',
    'lobby.kicker': 'Сетевая игра · Гонка и бой',
    'lobby.pilots': 'Пилоты',
    'lobby.voteMode': 'Голосование · Режим',
    'mode.race': 'Гонка',
    'mode.battle': 'Бой',
    'lobby.voteAircraft': 'Голосование · Самолёт',
    'lobby.voteTime': 'Голосование · Время суток',
    'lobby.voteFlags': 'Голосование · Ворота',
    'lobby.voteDuration': 'Голосование · Длительность',
    'lobby.mins': '{n} МИН',
    'lobby.yourLivery': 'Твоя окраска',
    'lobby.chat': 'Чат',
    'lobby.chatEmpty': 'Поздоровайся 👋',
    'lobby.chatPlaceholder': 'Сообщение…',
    'lobby.send': 'Отпр.',
    'lobby.startNow': 'Начать сейчас',
    'lobby.leave': 'Выйти из лобби',
    'lobby.hint':
      'Все летят на самолёте и во времени, выбранных большинством, по отдельной трассе. Пролетай через золотые ворота · SPACE — огонь · не дай себя сбить.',
    'lobby.hintBattle':
      'Все против всех над случайной местностью: побеждает тот, у кого больше сбитых к концу матча. Арена сужается — за стеной корпус горит. Сбивай шары «?» — случайный эффект, хороший или плохой, шансы равны.',
    'lobby.flags': '{n} ВОРОТ',
    'lobby.launching': 'Старт через {secs} с …  ({n}/{full})',
    'lobby.waitingShort': 'Ждём игроков …',
    'lobby.waiting': 'Ждём игроков …  ({n}/{full}) — хост может начать в любой момент',
    'lobby.count': '({n}/{full})',
    'lobby.you': ' (ты)',
    'lobby.voteNote': 'Летим: {plane} · {time} · ворот: {gates} (по большинству)',
    'lobby.voteNoteBattle': 'Бой: {plane} · {time} · {mins} мин (по большинству)',

    // ---- race ----
    'race.go': 'ВПЕРЁД!',
    'race.finished': 'ФИНИШ',
    'race.gate': 'ВОРОТА',
    'race.hull': 'КОРПУС',
    'race.title': 'ГОНКА',
    'race.results': '🏁 ИТОГИ',
    'race.dnf': 'НЕ ФИНИШ',
    'race.returning': 'возвращаемся в лобби…',

    // ---- battle (v1.1) ----
    'battle.title': 'БОЙ',
    'battle.results': '☠ ИТОГИ БОЯ',
    'battle.zoneWarn': 'ВНЕ ЗОНЫ — корпус горит!',
    'battle.storm': '⛈ АРЕНА СЖИМАЕТСЯ БЫСТРЕЕ!',
    'battle.aaDeployed': '🎯 РАЗВЁРНУТА УСТАНОВКА ПВО — СЛЕДИ ЗА ЗЕМЛЁЙ!',
    'battle.plusKill': '+1 ☠',
    // Названия эффектов-«сюрпризов» (раскрываются только при подборе).
    'fx.heal': '🔧 ПОЛНЫЙ РЕМОНТ',
    'fx.dmg2': '☠ ДВОЙНОЙ УРОН',
    'fx.boost': '⚡ ФОРСАЖ +50% ТЯГИ',
    'fx.dmg05': '💧 ПУШКИ-ПУКАЛКИ −50% УРОНА',
    'fx.fragile': '🥚 ХРУПКИЙ КОРПУС +50% К УРОНУ ПО ТЕБЕ',
    'fx.sputter': '💨 ДВИГАТЕЛЬ ЧИХАЕТ — ГАЗ ОГРАНИЧЕН',
    'fx.storm': '⛈ ШТОРМ — ты ускорил арену!',
    'fx.rockets': '🚀 5 САМОНАВОДЯЩИХСЯ РАКЕТ — зажми огонь для пуска',
    'fx.aa': '🎯 ТЫ РАЗВЕРНУЛ УСТАНОВКУ ПВО!',

    // ---- touch ----
    'touch.brake': 'ТОРМ',
    'touch.fire': 'ОГОНЬ',

    // ---- flight guide ----
    'guide.title': 'Как летать',
    'guide.step': 'Шаг {n} из {total}',
    'guide.next': 'Далее',
    'guide.prev': 'Назад',
    'guide.done': 'Понятно',
    'guide.skip': 'Пропустить',
    'guide.replayHint': 'Гайд можно открыть заново в настройках.',

    'guide.s1.title': 'Добро пожаловать на борт',
    'guide.s1.body':
      'Это спокойный авиасимулятор — без очков и таймеров, только ты и процедурный мир. Гайд займёт минуту и покроет всё, что нужно, чтобы взлететь, лететь и сесть.',
    'guide.s2.title': 'Газ и взлёт',
    'guide.s2.body':
      'Держи Shift, чтобы добавить газ, Ctrl — чтобы убрать. Разгонись по полосе примерно до 60 узлов и плавно подними нос клавишей S. Не дёргай — ровный небольшой набор работает лучше всего.',
    'guide.s2.keys': 'Shift — газ больше · Ctrl — газ меньше · S — нос вверх',
    'guide.s3.title': 'Управление',
    'guide.s3.body':
      'W и S опускают и поднимают нос. A и D кладут самолёт в крен — именно так и поворачивают: входишь в крен, затем чуть тянешь нос вверх. Q и E доворачивают хвостом для точной подстройки.',
    'guide.s3.keys': 'W/S — тангаж · A/D — крен · Q/E — рыскание',
    'guide.s4.title': 'Шасси',
    'guide.s4.body':
      'Нажми G и убери шасси, когда пошёл в набор — сопротивление падает, и самолёт заметно ускоряется. Не забудь выпустить их перед посадкой.',
    'guide.s4.keys': 'G — шасси убрать / выпустить',
    'guide.s5.title': 'Посадка',
    'guide.s5.body':
      'Убери газ, держи плавное снижение и выйди на створ полосы. Шасси выпущены, касание на 50–60 узлах, затем зажми Space для торможения. Ровно и медленно лучше, чем быстро и красиво.',
    'guide.s5.keys': 'Ctrl — газ меньше · G — шасси выпустить · Space — тормоза',
    'guide.s6.title': 'Камера и прочее',
    'guide.s6.body':
      'Зажми мышь, чтобы осмотреться. P включает фоторежим (свободный облёт, колесо — зум), L переключает фары, M выключает звук, а R возвращает тебя на полосу, если что-то пошло не так.',
    'guide.s6.keys': 'мышь — обзор · P — фото · L — фары · M — звук · R — сброс',
    'guide.s7.title': 'Игра с другими',
    'guide.s7.body':
      'Переключись в меню на игру по сети и нажми ГОНКА / БОЙ, чтобы попасть в лобби. Все голосуют за режим, самолёт и время суток. Гонка: пролетай золотые ворота по порядку. Бой: все против всех в сужающейся арене — побеждает тот, кто больше собьёт, а шары «?» дают случайный эффект, хороший или плохой. Space стреляет в обоих режимах.',
    'guide.s7.keys': 'Space — огонь · R — респавн у ворот (только в гонке)',
    'guide.s8.title': 'На телефоне или планшете',
    'guide.s8.body':
      'Сенсорное управление появляется само: левый стик рулит, правый слайдер — газ, кнопки отвечают за шасси, сброс и тормоза. В гонке добавляется кнопка ОГОНЬ.',
  },
};

// Number of steps in the flight guide (guide.s1 … guide.sN).
export const GUIDE_STEPS = 8;
