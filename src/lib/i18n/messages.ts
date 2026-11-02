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
    addFarmer: string;
    editFarmer: string;
    backToList: string;
    farmerId: string;
    centre: string;
    allCentres: string;
    allVillages: string;
    statusFilter: string;
    statusActive: string;
    statusInactive: string;
    statusAll: string;
    clearFilters: string;
    crops: string;
    bank: string;
    bankVerified: string;
    bankUnverified: string;
    bankNone: string;
    bankStaffOnly: string;
    holderName: string;
    accountNumber: string;
    accountKeepHint: string;
    ifsc: string;
    verifyBank: string;
    verifying: string;
    verifiedOn: string;
    verifyFailed: string;
    phone: string;
    notProvided: string;
    consent: string;
    consentLabel: string;
    consentNotRecorded: string;
    recentPurchases: string;
    noPurchases: string;
    slip: string;
    date: string;
    netWeight: string;
    amount: string;
    save: string;
    saving: string;
    cancel: string;
    sectionBasics: string;
    sectionBank: string;
    sectionBankHint: string;
    sectionConsent: string;
    previous: string;
    next: string;
    pageOf: string;
    formError: string;
    networkError: string;
    yes: string;
    no: string;
  };
  status: {
    approved: string;
    held: string;
    rejected: string;
    unpaid: string;
    in_run: string;
    paid: string;
    failed: string;
  };
  forbidden: { title: string; body: string };
  auth: { noProfileTitle: string; noProfileBody: string };
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
    searchPlaceholder: "सभासद क्रमांक किंवा नाव",
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
    addFarmer: "सभासद जोडा",
    editFarmer: "सभासद संपादित करा",
    backToList: "सभासदांकडे परत",
    farmerId: "सभासद क्रमांक",
    centre: "केंद्र",
    allCentres: "सर्व केंद्रे",
    allVillages: "सर्व गावे",
    statusFilter: "स्थिती",
    statusActive: "सक्रिय",
    statusInactive: "निष्क्रिय",
    statusAll: "सर्व",
    clearFilters: "फिल्टर काढा",
    crops: "पात्र पिके",
    bank: "बँक खाते",
    bankVerified: "पडताळलेले",
    bankUnverified: "पडताळणी बाकी",
    bankNone: "खाते नाही",
    bankStaffOnly: "बँक तपशील फक्त कार्यालयीन कर्मचाऱ्यांना दिसतात.",
    holderName: "खातेधारकाचे नाव",
    accountNumber: "खाते क्रमांक",
    accountKeepHint: "आहे तोच क्रमांक ठेवण्यासाठी रिकामे सोडा",
    ifsc: "IFSC कोड",
    verifyBank: "खाते पडताळले म्हणून नोंदवा",
    verifying: "नोंदवत आहे…",
    verifiedOn: "पडताळणी दिनांक",
    verifyFailed: "पडताळणी नोंदवता आली नाही.",
    phone: "मोबाइल",
    notProvided: "दिलेले नाही",
    consent: "संमती",
    consentLabel: "सभासदाने त्यांची माहिती वापरण्यास संमती दिली आहे.",
    consentNotRecorded: "संमती नोंदलेली नाही",
    recentPurchases: "अलीकडील खरेदी",
    noPurchases: "अजून खरेदी नाही.",
    slip: "पावती",
    date: "दिनांक",
    netWeight: "निव्वळ वजन",
    amount: "रक्कम",
    save: "जतन करा",
    saving: "जतन होत आहे…",
    cancel: "रद्द करा",
    sectionBasics: "सभासद माहिती",
    sectionBank: "बँक खाते",
    sectionBankHint: "बँक तपशील नंतरही जोडता येतील.",
    sectionConsent: "संमती",
    previous: "मागील",
    next: "पुढील",
    pageOf: "पान",
    formError: "कृपया लाल रंगातील चुका दुरुस्त करा.",
    networkError: "नेटवर्क उपलब्ध नाही. पुन्हा प्रयत्न करा.",
    yes: "होय",
    no: "नाही",
  },
  status: {
    approved: "मंजूर",
    held: "तपासणीसाठी थांबवले",
    rejected: "नाकारले",
    unpaid: "देय",
    in_run: "पेमेंट यादीत",
    paid: "दिले",
    failed: "अयशस्वी",
  },
  forbidden: {
    title: "प्रवेश नाही",
    body: "हे पान पाहण्याची परवानगी आपल्या खात्याला नाही.",
  },
  auth: {
    noProfileTitle: "खाते तयार नाही",
    noProfileBody: "आपले लॉगिन बरोबर आहे, पण कर्मचारी प्रोफाइल सक्रिय नाही. कार्यालय व्यवस्थापकाशी संपर्क करा.",
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
    searchPlaceholder: "Farmer ID or name",
    code: "Code",
    name: "Name",
    village: "Village",
    land: "Land",
    acres: "acres",
    none: "No members registered yet.",
    noneForSearch: "No members match these filters.",
    showing: "Showing",
    loadError: "Could not load the member list.",
    reload: "Try again",
    addFarmer: "Add farmer",
    editFarmer: "Edit farmer",
    backToList: "Back to members",
    farmerId: "Farmer ID",
    centre: "Centre",
    allCentres: "All centres",
    allVillages: "All villages",
    statusFilter: "Status",
    statusActive: "Active",
    statusInactive: "Inactive",
    statusAll: "All",
    clearFilters: "Clear filters",
    crops: "Eligible crops",
    bank: "Bank account",
    bankVerified: "Verified",
    bankUnverified: "Not verified",
    bankNone: "No account",
    bankStaffOnly: "Bank details are visible to office staff only.",
    holderName: "Account holder name",
    accountNumber: "Account number",
    accountKeepHint: "Leave empty to keep the current number",
    ifsc: "IFSC code",
    verifyBank: "Mark account as verified",
    verifying: "Saving…",
    verifiedOn: "Verified on",
    verifyFailed: "Could not record the verification.",
    phone: "Mobile",
    notProvided: "Not provided",
    consent: "Consent",
    consentLabel: "The member has agreed to their data being used.",
    consentNotRecorded: "Consent not recorded",
    recentPurchases: "Recent purchases",
    noPurchases: "No purchases yet.",
    slip: "Slip",
    date: "Date",
    netWeight: "Net weight",
    amount: "Amount",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    sectionBasics: "Farmer details",
    sectionBank: "Bank account",
    sectionBankHint: "Bank details can also be added later.",
    sectionConsent: "Consent",
    previous: "Previous",
    next: "Next",
    pageOf: "Page",
    formError: "Please correct the highlighted fields.",
    networkError: "No network. Please try again.",
    yes: "Yes",
    no: "No",
  },
  status: {
    approved: "Approved",
    held: "Held for review",
    rejected: "Rejected",
    unpaid: "Unpaid",
    in_run: "In payment run",
    paid: "Paid",
    failed: "Failed",
  },
  forbidden: {
    title: "No access",
    body: "Your account does not have permission to view this page.",
  },
  auth: {
    noProfileTitle: "Account not set up",
    noProfileBody: "Your login is correct, but there is no active staff profile for it. Please contact an office manager.",
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
