// Privacy notice, terms of use and third-party licences for the Legal screen.
//
// ⚠️ DRAFT — written to match what the code actually does (see the audit in
// git history), but it is NOT legal advice and has not been reviewed by a
// lawyer. Read it before publishing, add the missing contact + governing-law
// paragraphs (see TODO below), and keep it in sync if data handling changes.
//
// Kept out of strings.js on purpose: it's long-form prose, not UI labels, and
// it should be editable without touching the interface dictionary.

// TODO(owner): still missing, to be added once decided —
//   * a contact address (abuse reports / data questions), and
//   * a governing-law clause.
// The paragraphs that would have carried them were removed rather than shipped
// with visible placeholders; re-add both sections when the details exist.

export const LEGAL_UPDATED = '2026-07-25';

export const LEGAL = {
  en: [
    {
      title: 'In short',
      body: [
        'MBPlanes is a free browser game. There are no accounts, no sign-up, no payments and no advertising. Nothing you do here is tracked or sold.',
        'The only personal data that touches the server is a truncated IP address in its connection log, plus whatever nickname and chat messages you choose to type while playing online.',
      ],
    },
    {
      title: 'Privacy · what stays on your device',
      body: [
        'Your settings are saved in your browser\'s local storage and never leave your device: interface language, graphics and view-distance presets, chosen aircraft and livery, your nickname, the world seed, and a flag remembering that you have seen the flight guide.',
        'There are no cookies, no analytics, no trackers and no third-party scripts. Fonts and all other assets are served from this site\'s own server, so loading the page makes no requests to anyone else.',
        'Clearing your browser data for this site removes all of it.',
      ],
    },
    {
      title: 'Privacy · multiplayer',
      body: [
        'When you play online, the server receives your nickname, your aircraft type and colour, its position, orientation, throttle and gear state, your gate progress, shots and hits, and any chat messages you send. It relays them, live, to the other players in your room — that is the whole point of multiplayer.',
        'None of it is written to a database or a file. It exists only in the server process\'s memory and is gone when you disconnect or the server restarts. Chat history is not stored: every lobby starts empty, and the log is cleared when a race launches.',
        'The server writes a line to its log when someone connects or disconnects. The IP address in that line is truncated (for example 176.59.x.x), which is enough to investigate abuse and not enough to identify a person. Those logs live only in the server\'s container output.',
        'Your nickname is free text and is shown to everyone in the lobby, the leaderboard and the results. Please do not type your real name, address, phone number or any other personal detail into it.',
      ],
    },
    {
      title: 'Terms · the game is provided as-is',
      body: [
        'The game is free and offered "as is", without warranty of any kind. It may contain bugs, may be changed, interrupted or shut down at any time, and no particular availability is promised.',
        'To the fullest extent permitted by law, the author is not liable for any damage or loss arising from your use of the game.',
      ],
    },
    {
      title: 'Terms · how to behave',
      body: [
        'The chat and the multiplayer world are public and shared with strangers. When using them you agree not to:',
      ],
      list: [
        'harass, threaten, insult or discriminate against other players',
        'post hate speech, sexual content involving minors, or anything illegal',
        'spam, flood, advertise, or post links to malware',
        'publish other people\'s personal data',
        'cheat, exploit bugs to grief others, or attack the server or protocol',
      ],
    },
    {
      title: 'Terms · moderation and age',
      body: [
        'An obscenity filter and rate limits run on the server, but the chat is public and is not moderated in real time. You may be disconnected or blocked for breaking the rules above.',
        'Because of the open chat, the game is intended for players aged 13 and over. It is not directed at younger children, and it collects no personal data from them beyond the truncated connection log described above. If you are under the age of majority where you live, please play with your parents\' knowledge.',
      ],
    },
    {
      title: 'Third-party licences',
      body: [
        'MBPlanes is built on open-source work, used under the following licences. Full licence texts ship with each package in the project repository.',
      ],
      list: [
        'three.js — MIT Licence, © three.js authors',
        'simplex-noise — MIT Licence',
        'alea — MIT Licence',
        'ws — MIT Licence',
        'Vite — MIT Licence',
        'Space Grotesk (typeface) — SIL Open Font Licence 1.1, Florian Karsten',
        'Sora (typeface) — SIL Open Font Licence 1.1, Indian Type Foundry',
      ],
    },
  ],

  ru: [
    {
      title: 'Коротко',
      body: [
        'MBPlanes — бесплатная браузерная игра. Здесь нет аккаунтов, регистрации, платежей и рекламы. Ничего из того, что ты делаешь, не отслеживается и не продаётся.',
        'Единственные персональные данные, которые попадают на сервер, — обрезанный IP-адрес в логе подключений, а также ник и сообщения чата, которые ты сам вводишь при игре по сети.',
      ],
    },
    {
      title: 'Приватность · что остаётся на твоём устройстве',
      body: [
        'Настройки сохраняются в локальном хранилище браузера и никуда не отправляются: язык интерфейса, пресеты графики и дальности прорисовки, выбранный самолёт и окраска, ник, сид мира и отметка о том, что гайд уже просмотрен.',
        'Нет ни куки, ни аналитики, ни трекеров, ни сторонних скриптов. Шрифты и все остальные файлы отдаются с сервера самой игры, поэтому при загрузке страницы не происходит обращений к третьим лицам.',
        'Если очистить данные браузера для этого сайта, всё перечисленное удалится.',
      ],
    },
    {
      title: 'Приватность · игра по сети',
      body: [
        'При игре по сети сервер получает твой ник, тип и цвет самолёта, его позицию, ориентацию, тягу и состояние шасси, прогресс по воротам, выстрелы и попадания, а также сообщения чата. Всё это в реальном времени передаётся другим игрокам в твоей комнате — в этом и смысл сетевой игры.',
        'Ничего из этого не пишется в базу данных или файл. Данные существуют только в памяти процесса сервера и исчезают при отключении или перезапуске. История чата не хранится: каждое лобби начинается пустым, а при старте гонки чат очищается.',
        'Сервер пишет строку в лог при подключении и отключении. IP-адрес в этой строке обрезан (например, 176.59.x.x) — этого достаточно для разбора злоупотреблений и недостаточно для идентификации человека. Логи существуют только в выводе контейнера сервера.',
        'Ник — это свободное поле, и он виден всем в лобби, в таблице и в итогах гонки. Пожалуйста, не вписывай туда настоящее имя, адрес, телефон или другие личные данные.',
      ],
    },
    {
      title: 'Условия · игра предоставляется «как есть»',
      body: [
        'Игра бесплатна и предоставляется «как есть», без каких-либо гарантий. В ней могут быть ошибки, она может измениться, стать недоступной или быть закрыта в любой момент; какая-либо доступность не гарантируется.',
        'В максимально допустимой законом степени автор не несёт ответственности за любой ущерб или убытки, возникшие из-за использования игры.',
      ],
    },
    {
      title: 'Условия · как себя вести',
      body: [
        'Чат и сетевой мир публичны, в них находятся посторонние люди. Пользуясь ими, ты соглашаешься не делать следующего:',
      ],
      list: [
        'преследовать, угрожать, оскорблять и дискриминировать других игроков',
        'публиковать язык вражды, сексуальный контент с участием несовершеннолетних и любой незаконный материал',
        'спамить, флудить, рекламировать и кидать ссылки на вредоносное ПО',
        'публиковать персональные данные других людей',
        'читерить, использовать баги во вред другим, атаковать сервер или протокол',
      ],
    },
    {
      title: 'Условия · модерация и возраст',
      body: [
        'На сервере работают фильтр нецензурной лексики и ограничение частоты сообщений, но чат публичный и не модерируется в реальном времени. За нарушение правил выше тебя могут отключить или заблокировать.',
        'Из-за открытого чата игра предназначена для игроков 13 лет и старше. Она не адресована детям младшего возраста и не собирает у них персональных данных, кроме обрезанного лога подключений, описанного выше. Если ты не достиг совершеннолетия по законам своей страны, играй с ведома родителей.',
      ],
    },
    {
      title: 'Лицензии третьих лиц',
      body: [
        'MBPlanes построена на открытом коде, используемом по следующим лицензиям. Полные тексты лицензий поставляются с каждым пакетом в репозитории проекта.',
      ],
      list: [
        'three.js — лицензия MIT, © авторы three.js',
        'simplex-noise — лицензия MIT',
        'alea — лицензия MIT',
        'ws — лицензия MIT',
        'Vite — лицензия MIT',
        'Space Grotesk (шрифт) — SIL Open Font License 1.1, Florian Karsten',
        'Sora (шрифт) — SIL Open Font License 1.1, Indian Type Foundry',
      ],
    },
  ],
};
