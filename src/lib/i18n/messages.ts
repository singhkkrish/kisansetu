export interface Messages {
  appName: string;
  signIn: string;
  signInIntro: string;
  email: string;
  password: string;
  signingIn: string;
  signInFailed: string;
  setupRequiredTitle: string;
  setupRequiredBody: string;
  nav: { dashboard: string; members: string };
  signOut: string;
  dashboard: {
    welcome: string;
    todaysPrices: string;
    noPricesToday: string;
    perQuintal: string;
    grade: string;
    priceLoadError: string;
    membersCount: string;
    centresCount: string;
    heldCount: string;
  };
  crops: { soybean: string; tur: string };
  sync: {
    title: string;
    online: string;
    offline: string;
    pending: string;
    slipsLeft: string;
    syncNow: string;
    syncing: string;
    getSlips: string;
    gettingSlips: string;
    allSynced: string;
    nothingPending: string;
    result: string;
    flaggedNote: string;
    rejectedNote: string;
    offlineStopped: string;
    signedOut: string;
    serverError: string;
    slipsFailed: string;
    slipsReceived: string;
  };
  members: {
    title: string;
    search: string;
    searchPlaceholder: string;
    code: string;
    name: string;
    village: string;
    land: string;
    acres: string;
    none: string;
    noneForSearch: string;
    showing: string;
    loadError: string;
    reload: string;
  };
  errors: { title: string; body: string; retry: string };
}

export const mr: Messages = {
  appName: "किसानसेतू",
  signIn: "लॉगिन",
  signInIntro: "आपल्या खात्याने प्रवेश करा.",
  email: "ईमेल",
  password: "पासवर्ड",
  signingIn: "लॉगिन होत आहे…",
  signInFailed: "ईमेल किंवा पासवर्ड चुकीचा आहे.",
  setupRequiredTitle: "सेटअप आवश्यक",
  setupRequiredBody:
    "Supabase जोडलेले नाही. .env.local मध्ये NEXT_PUBLIC_SUPABASE_URL आणि NEXT_PUBLIC_SUPABASE_ANON_KEY भरा.",
  nav: { dashboard: "डॅशबोर्ड", members: "सभासद" },
  signOut: "बाहेर पडा",
  dashboard: {
    welcome: "नमस्कार",
    todaysPrices: "आजचे दर",
    noPricesToday: "आजचे दर अजून जाहीर झालेले नाहीत.",
    perQuintal: "प्रति क्विंटल",
    grade: "ग्रेड",
    priceLoadError: "दर मिळवता आले नाहीत.",
    membersCount: "सभासद",
    centresCount: "केंद्रे",
    heldCount: "तपासणीसाठी थांबलेल्या नोंदी",
  },
  crops: { soybean: "सोयाबीन", tur: "तूर" },
  sync: {
    title: "सिंक स्थिती",
    online: "ऑनलाइन",
    offline: "ऑफलाइन",
    pending: "पाठवायच्या नोंदी",
    slipsLeft: "उरलेले पावती क्रमांक",
    syncNow: "आता सिंक करा",
    syncing: "सिंक होत आहे…",
    getSlips: "पावती क्रमांक मिळवा",
    gettingSlips: "मिळवत आहे…",
    allSynced: "सर्व नोंदी सिंक झाल्या आहेत.",
    nothingPending: "पाठवण्यासाठी काहीही नाही.",
    result: "सिंक पूर्ण",
    flaggedNote: "तपासणीसाठी थांबवल्या",
    rejectedNote: "नाकारल्या",
    offlineStopped: "नेटवर्क नाही. नोंदी फोनवर सुरक्षित आहेत.",
    signedOut: "सत्र संपले. पुन्हा लॉगिन करा.",
    serverError: "सर्व्हर त्रुटी. थोड्या वेळाने पुन्हा प्रयत्न करा.",
    slipsFailed: "पावती क्रमांक मिळवता आले नाहीत.",
    slipsReceived: "पावती क्रमांक मिळाले.",
  },
  members: {
    title: "शेतकरी सभासद",
    search: "शोधा",
    searchPlaceholder: "नाव, गाव किंवा सभासद क्रमांक",
    code: "क्रमांक",
    name: "नाव",
    village: "गाव",
    land: "जमीन",
    acres: "एकर",
    none: "अजून सभासद नोंदवलेले नाहीत.",
    noneForSearch: "या शोधासाठी सभासद आढळले नाहीत.",
    showing: "दाखवले",
    loadError: "सभासदांची यादी मिळवता आली नाही.",
    reload: "पुन्हा प्रयत्न करा",
  },
  errors: {
    title: "काहीतरी चुकले",
    body: "पान उघडता आले नाही. पुन्हा प्रयत्न करा.",
    retry: "पुन्हा प्रयत्न करा",
  },
};

export const en: Messages = {
  appName: "KisanSetu",
  signIn: "Sign in",
  signInIntro: "Sign in with your staff account.",
  email: "Email",
  password: "Password",
  signingIn: "Signing in…",
  signInFailed: "Incorrect email or password.",
  setupRequiredTitle: "Setup required",
  setupRequiredBody:
    "Supabase is not connected. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
  nav: { dashboard: "Dashboard", members: "Members" },
  signOut: "Sign out",
  dashboard: {
    welcome: "Hello",
    todaysPrices: "Today's prices",
    noPricesToday: "Today's prices have not been published yet.",
    perQuintal: "per quintal",
    grade: "Grade",
    priceLoadError: "Could not load prices.",
    membersCount: "Members",
    centresCount: "Centres",
    heldCount: "Entries held for review",
  },
  crops: { soybean: "Soybean", tur: "Tur" },
  sync: {
    title: "Sync status",
    online: "Online",
    offline: "Offline",
    pending: "Entries waiting to send",
    slipsLeft: "Slip numbers left",
    syncNow: "Sync now",
    syncing: "Syncing…",
    getSlips: "Get slip numbers",
    gettingSlips: "Getting…",
    allSynced: "Everything is synced.",
    nothingPending: "Nothing to send.",
    result: "Sync finished",
    flaggedNote: "held for review",
    rejectedNote: "rejected",
    offlineStopped: "No network. Entries are safe on this phone.",
    signedOut: "Session expired. Please sign in again.",
    serverError: "Server error. Try again shortly.",
    slipsFailed: "Could not get slip numbers.",
    slipsReceived: "Slip numbers received.",
  },
  members: {
    title: "Farmer members",
    search: "Search",
    searchPlaceholder: "Name, village or member code",
    code: "Code",
    name: "Name",
    village: "Village",
    land: "Land",
    acres: "acres",
    none: "No members registered yet.",
    noneForSearch: "No members match this search.",
    showing: "Showing",
    loadError: "Could not load the member list.",
    reload: "Try again",
  },
  errors: {
    title: "Something went wrong",
    body: "This page could not be loaded. Please try again.",
    retry: "Try again",
  },
};

export function getMessages(lang: "mr" | "en"): Messages {
  return lang === "en" ? en : mr;
}
