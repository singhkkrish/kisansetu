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
  nav: { dashboard: string; members: string; collect: string; entries: string };
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
    synced: string;
    failed: string;
    lastSync: string;
    never: string;
    retryFailed: string;
    retrying: string;
    waitingToRetry: string;
    lastAttemptFailed: string;
    offlineHint: string;
    failedHint: string;
    neverSyncedHint: string;
    refreshData: string;
    refreshing: string;
    dataUpdated: string;
    dataFailed: string;
    farmersCached: string;
  };
  collect: {
    title: string;
    stepOf: string;
    steps: { farmer: string; crop: string; gross: string; tare: string; moisture: string; grade: string; review: string };
    searchFarmer: string;
    searchPlaceholder: string;
    noResults: string;
    emptyCache: string;
    emptyCacheOffline: string;
    notEligible: string;
    selectCrop: string;
    selectGrade: string;
    gross: string;
    tare: string;
    moisture: string;
    kg: string;
    percent: string;
    rate: string;
    rateToday: string;
    perQuintal: string;
    noRateTitle: string;
    noRateBody: string;
    weighed: string;
    deduction: string;
    netWeight: string;
    amount: string;
    reviewIntro: string;
    farmer: string;
    crop: string;
    grade: string;
    next: string;
    back: string;
    save: string;
    saving: string;
    newEntry: string;
    viewEntries: string;
    savedTitle: string;
    savedOffline: string;
    savedOnline: string;
    slipNo: string;
    errors: {
      required: string;
      number: string;
      decimals: string;
      grossPositive: string;
      tareTooHigh: string;
      moistureTooHigh: string;
      noSlips: string;
      wrongCentre: string;
      saveFailed: string;
    };
    slipsLow: string;
    offlineBanner: string;
  };
  procurement: {
    title: string;
    mine: string;
    empty: string;
    emptyHeld: string;
    slip: string;
    farmer: string;
    crop: string;
    grade: string;
    net: string;
    amount: string;
    centre: string;
    status: string;
    approval: string;
    payment: string;
    syncState: { pending: string; synced: string; rejected: string };
    approvalState: { approved: string; held: string; rejected: string };
    paymentState: { unpaid: string; in_run: string; paid: string; failed: string };
    filterAll: string;
    filterHeld: string;
    filterApproved: string;
    filterRejected: string;
    deviceTime: string;
    deviceTimeNote: string;
    serverTime: string;
    notYetOnServer: string;
    clockOffset: string;
    detailTitle: string;
    backToList: string;
    notFound: string;
    loadError: string;
    figures: string;
    gross: string;
    tare: string;
    moisture: string;
    rate: string;
    createdBy: string;
    flags: string;
    noFlags: string;
    flagLabels: Record<string, string>;
    audit: string;
    auditCreated: string;
    auditChanged: string;
    auditBy: string;
    reviewNote: string;
    review: { title: string; intro: string; approve: string; hold: string; reject: string; note: string; notePlaceholder: string; needNote: string; done: string; failed: string; locked: string; operatorReadOnly: string };
    showing: string;
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
  nav: { dashboard: "डॅशबोर्ड", members: "सभासद", collect: "खरेदी", entries: "नोंदी" },
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
    synced: "सिंक झालेल्या",
    failed: "अयशस्वी",
    lastSync: "शेवटचे यशस्वी सिंक",
    never: "अजून झालेले नाही",
    retryFailed: "अयशस्वी नोंदी पुन्हा पाठवा",
    retrying: "पुन्हा पाठवत आहे…",
    waitingToRetry: "थोड्या वेळाने आपोआप पुन्हा प्रयत्न होईल.",
    lastAttemptFailed: "शेवटचा प्रयत्न अयशस्वी झाला. नोंदी फोनवर सुरक्षित आहेत.",
    offlineHint: "ऑफलाइन आहात. नोंदी फोनवर सुरक्षित राहतील आणि नेटवर्क आल्यावर पाठवल्या जातील.",
    failedHint: "सर्व्हरने काही नोंदी स्वीकारल्या नाहीत. कारण दुरुस्त करून पुन्हा पाठवा.",
    neverSyncedHint: "सर्व्हरने पुष्टी केल्याशिवाय नोंद “सिंक झाली” दिसत नाही.",
    refreshData: "शेतकरी व दर अद्ययावत करा",
    refreshing: "डाउनलोड होत आहे…",
    dataUpdated: "शेतकरी व दर अद्ययावत झाले.",
    dataFailed: "डाउनलोड अयशस्वी. जुनी माहिती वापरात आहे.",
    farmersCached: "फोनवरील शेतकरी",
  },
  collect: {
    title: "नवीन खरेदी नोंद",
    stepOf: "पायरी {n} / {total}",
    steps: { farmer: "शेतकरी", crop: "पीक", gross: "एकूण वजन", tare: "टेअर वजन", moisture: "आर्द्रता", grade: "प्रत व दर", review: "तपासा व जतन करा" },
    searchFarmer: "शेतकरी शोधा",
    searchPlaceholder: "नाव, सभासद क्रमांक किंवा गाव",
    noResults: "कोणताही शेतकरी सापडला नाही.",
    emptyCache: "फोनवर शेतकऱ्यांची यादी नाही. इंटरनेट असताना डाउनलोड करा.",
    emptyCacheOffline: "फोनवर शेतकऱ्यांची यादी नाही. नेटवर्क आल्यावर डाउनलोड करा.",
    notEligible: "हा शेतकरी या पिकासाठी नोंदलेला नाही. नोंद करता येईल, पण तपासा.",
    selectCrop: "कोणते पीक?",
    selectGrade: "प्रत निवडा",
    gross: "एकूण वजन",
    tare: "टेअर वजन",
    moisture: "आर्द्रता",
    kg: "किलो",
    percent: "%",
    rate: "दर",
    rateToday: "आजचा जाहीर दर",
    perQuintal: "प्रति क्विंटल",
    noRateTitle: "आजचा दर उपलब्ध नाही",
    noRateBody: "या पिकाचा व प्रतीचा आजचा दर फोनवर नाही. नेटवर्क असताना दर अद्ययावत करा. दराशिवाय नोंद जतन होणार नाही.",
    weighed: "एकूण − टेअर",
    deduction: "आर्द्रता कपात",
    netWeight: "निव्वळ वजन",
    amount: "रक्कम",
    reviewIntro: "सर्व तपशील तपासा. जतन केल्यावर नोंद बदलता येणार नाही.",
    farmer: "शेतकरी",
    crop: "पीक",
    grade: "प्रत",
    next: "पुढे",
    back: "मागे",
    save: "नोंद जतन करा",
    saving: "जतन होत आहे…",
    newEntry: "नवीन नोंद",
    viewEntries: "नोंदी पहा",
    savedTitle: "नोंद जतन झाली",
    savedOffline: "नोंद फोनवर सुरक्षित आहे आणि सर्व्हरला पाठवणे बाकी आहे. नेटवर्क आल्यावर आपोआप पाठवली जाईल.",
    savedOnline: "नोंद फोनवर जतन झाली. सर्व्हरने पुष्टी केल्यावर ती “सिंक झाली” दिसेल.",
    slipNo: "पावती क्रमांक",
    errors: {
      required: "हे आवश्यक आहे",
      number: "फक्त अंक लिहा",
      decimals: "एकच दशांश स्थान चालेल",
      grossPositive: "एकूण वजन शून्यापेक्षा जास्त हवे",
      tareTooHigh: "टेअर वजन एकूण वजनापेक्षा कमी हवे",
      moistureTooHigh: "३०% पेक्षा जास्त आर्द्रतेचे धान्य खरेदी करता येत नाही",
      noSlips: "पावती क्रमांक संपले. इंटरनेट असताना नवीन क्रमांक मिळवा.",
      wrongCentre: "फोनवरील पावती क्रमांक दुसऱ्या केंद्राचे आहेत. नेटवर्कवर नवीन क्रमांक मिळवा.",
      saveFailed: "नोंद जतन होऊ शकली नाही. पुन्हा प्रयत्न करा.",
    },
    slipsLow: "पावती क्रमांक कमी उरले आहेत. इंटरनेट असताना नवीन मिळवा.",
    offlineBanner: "ऑफलाइन — नोंदी फोनवर जतन होतील.",
  },
  procurement: {
    title: "खरेदी नोंदी",
    mine: "या फोनवरील माझ्या नोंदी",
    empty: "अजून कोणतीही नोंद नाही.",
    emptyHeld: "या गटात कोणतीही नोंद नाही.",
    slip: "पावती",
    farmer: "शेतकरी",
    crop: "पीक",
    grade: "प्रत",
    net: "निव्वळ वजन",
    amount: "रक्कम",
    centre: "केंद्र",
    status: "स्थिती",
    approval: "मंजुरी",
    payment: "देयक",
    syncState: { pending: "पाठवणे बाकी", synced: "सिंक झाली", rejected: "नाकारली" },
    approvalState: { approved: "मंजूर", held: "तपासणीसाठी थांबवली", rejected: "नाकारली" },
    paymentState: { unpaid: "देय बाकी", in_run: "देयक यादीत", paid: "दिले", failed: "अयशस्वी" },
    filterAll: "सर्व",
    filterHeld: "थांबवलेल्या",
    filterApproved: "मंजूर",
    filterRejected: "नाकारलेल्या",
    deviceTime: "फोनवरील वेळ (पडताळलेली नाही)",
    deviceTimeNote: "ही वेळ फोनच्या घड्याळातून आली आहे. ती पडताळलेली नाही.",
    serverTime: "सर्व्हरवर मिळाल्याची वेळ",
    notYetOnServer: "अजून सर्व्हरला पोहोचलेली नाही",
    clockOffset: "फोन घड्याळातील फरक",
    detailTitle: "नोंदीचा तपशील",
    backToList: "नोंदींकडे परत",
    notFound: "ही नोंद सापडली नाही.",
    loadError: "नोंदी लोड करता आल्या नाहीत.",
    figures: "वजन व रक्कम",
    gross: "एकूण वजन",
    tare: "टेअर वजन",
    moisture: "आर्द्रता",
    rate: "दर / क्विंटल",
    createdBy: "नोंद करणारा",
    flags: "तपासणीची कारणे",
    noFlags: "कोणतेही कारण नाही",
    flagLabels: {
      rate_mismatch: "दर जाहीर दराशी जुळत नाही",
      no_price_for_day: "त्या दिवसाचा दर जाहीर नव्हता",
      clock_ahead: "फोनचे घड्याळ पुढे होते",
      clock_skew: "फोनच्या घड्याळात मोठा फरक",
      superseded_rate: "नंतर दुरुस्त झालेला जुना दर वापरला",
      chain_gap: "फोनवरील नोंदींच्या साखळीत खंड",
      manual_hold: "व्यवस्थापकाने थांबवली",
      weight_vs_land: "वजन शेतजमिनीच्या तुलनेत जास्त वाटते",
      repeat_within_hour: "एका तासात याच शेतकऱ्याच्या अनेक नोंदी",
      uniform_moisture: "या केंद्रावर ओलावा अतिशय सारखा नोंदवला जात आहे",
      weight_pattern_change: "वजन शेतकऱ्याच्या नेहमीच्या वजनापेक्षा खूप वेगळे",
      moisture_pattern_change: "ओलावा शेतकऱ्याच्या नेहमीच्या ओलाव्यापेक्षा खूप वेगळा",
    },
    audit: "बदलांचा इतिहास",
    auditCreated: "नोंद तयार झाली",
    auditChanged: "स्थिती बदलली",
    auditBy: "द्वारे",
    reviewNote: "व्यवस्थापकाची टीप",
    review: {
      title: "व्यवस्थापक तपासणी",
      intro: "मंजूर करणे, थांबवणे किंवा नाकारणे. प्रत्येक बदल इतिहासात नोंदवला जातो. वजन व रक्कम बदलता येत नाही.",
      approve: "मंजूर करा",
      hold: "थांबवा",
      reject: "नाकारा",
      note: "कारण",
      notePlaceholder: "किमान ५ अक्षरे (थांबवण्यासाठी किंवा नाकारण्यासाठी आवश्यक)",
      needNote: "कारण लिहा (किमान ५ अक्षरे).",
      done: "बदल जतन झाला.",
      failed: "बदल जतन होऊ शकला नाही.",
      locked: "ही नोंद देयक यादीत आहे, त्यामुळे बदलता येत नाही.",
      operatorReadOnly: "मंजुरी फक्त कार्यालय व्यवस्थापक बदलू शकतात.",
    },
    showing: "दाखवत आहे",
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
  nav: { dashboard: "Dashboard", members: "Members", collect: "Collect", entries: "Entries" },
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
    synced: "Synced",
    failed: "Failed",
    lastSync: "Last successful sync",
    never: "Not yet",
    retryFailed: "Retry failed entries",
    retrying: "Retrying…",
    waitingToRetry: "It will retry automatically in a little while.",
    lastAttemptFailed: "The last attempt failed. Entries are safe on this phone.",
    offlineHint: "You are offline. Entries stay safe on this phone and are sent when the network is back.",
    failedHint: "The server did not accept some entries. Fix the cause, then retry them.",
    neverSyncedHint: "An entry only shows as synced after the server confirms it.",
    refreshData: "Refresh farmers and rates",
    refreshing: "Downloading…",
    dataUpdated: "Farmers and rates are up to date.",
    dataFailed: "Download failed. The previous data is still in use.",
    farmersCached: "Farmers on this phone",
  },
  collect: {
    title: "New procurement entry",
    stepOf: "Step {n} of {total}",
    steps: { farmer: "Farmer", crop: "Crop", gross: "Gross weight", tare: "Tare weight", moisture: "Moisture", grade: "Grade and rate", review: "Review and save" },
    searchFarmer: "Find the farmer",
    searchPlaceholder: "Name, member ID or village",
    noResults: "No farmer found.",
    emptyCache: "No farmers are stored on this phone. Download them while you have internet.",
    emptyCacheOffline: "No farmers are stored on this phone. Download them when the network is back.",
    notEligible: "This farmer is not registered for this crop. You can continue, but please check.",
    selectCrop: "Which crop?",
    selectGrade: "Choose the grade",
    gross: "Gross weight",
    tare: "Tare weight",
    moisture: "Moisture",
    kg: "kg",
    percent: "%",
    rate: "Rate",
    rateToday: "Today's published rate",
    perQuintal: "per quintal",
    noRateTitle: "No rate for today",
    noRateBody: "This phone has no published rate for this crop and grade today. Refresh the rates while you have network. An entry cannot be saved without a rate.",
    weighed: "Gross − tare",
    deduction: "Moisture deduction",
    netWeight: "Net weight",
    amount: "Amount",
    reviewIntro: "Check every detail. Once saved, an entry cannot be edited.",
    farmer: "Farmer",
    crop: "Crop",
    grade: "Grade",
    next: "Next",
    back: "Back",
    save: "Save entry",
    saving: "Saving…",
    newEntry: "New entry",
    viewEntries: "View entries",
    savedTitle: "Entry saved",
    savedOffline: "The entry is safe on this phone and waiting to be sent. It will be sent automatically when the network is back.",
    savedOnline: "The entry is saved on this phone. It will show as synced once the server confirms it.",
    slipNo: "Slip number",
    errors: {
      required: "This is required",
      number: "Enter numbers only",
      decimals: "One decimal place at most",
      grossPositive: "Gross weight must be more than zero",
      tareTooHigh: "Tare must be less than gross weight",
      moistureTooHigh: "Grain above 30% moisture cannot be bought",
      noSlips: "No slip numbers left. Get new ones while you have internet.",
      wrongCentre: "The slip numbers on this phone belong to another centre. Get new ones online.",
      saveFailed: "Could not save the entry. Please try again.",
    },
    slipsLow: "Slip numbers are running low. Get more while you have internet.",
    offlineBanner: "Offline — entries are saved on this phone.",
  },
  procurement: {
    title: "Procurement entries",
    mine: "My entries on this phone",
    empty: "No entries yet.",
    emptyHeld: "No entries in this group.",
    slip: "Slip",
    farmer: "Farmer",
    crop: "Crop",
    grade: "Grade",
    net: "Net weight",
    amount: "Amount",
    centre: "Centre",
    status: "Status",
    approval: "Approval",
    payment: "Payment",
    syncState: { pending: "Waiting to send", synced: "Synced", rejected: "Rejected" },
    approvalState: { approved: "Approved", held: "Held for review", rejected: "Rejected" },
    paymentState: { unpaid: "Unpaid", in_run: "In payment run", paid: "Paid", failed: "Failed" },
    filterAll: "All",
    filterHeld: "Held",
    filterApproved: "Approved",
    filterRejected: "Rejected",
    deviceTime: "Recorded on phone (unverified)",
    deviceTimeNote: "This time comes from the phone's own clock and has not been verified.",
    serverTime: "Received by server",
    notYetOnServer: "Not yet received by the server",
    clockOffset: "Phone clock offset",
    detailTitle: "Entry details",
    backToList: "Back to entries",
    notFound: "This entry was not found.",
    loadError: "Could not load entries.",
    figures: "Weights and amount",
    gross: "Gross weight",
    tare: "Tare weight",
    moisture: "Moisture",
    rate: "Rate / quintal",
    createdBy: "Created by",
    flags: "Reasons for review",
    noFlags: "None",
    flagLabels: {
      rate_mismatch: "Rate differs from the published rate",
      no_price_for_day: "No rate was published for that day",
      clock_ahead: "Phone clock was ahead of the server",
      clock_skew: "Phone clock was far from the server's",
      superseded_rate: "Used an earlier rate that was later corrected",
      chain_gap: "Gap in the phone's entry chain",
      manual_hold: "Held by a manager",
      weight_vs_land: "Weight looks high for the land area",
      repeat_within_hour: "Several entries for this farmer within an hour",
      uniform_moisture: "Moisture readings at this centre are unusually uniform",
      weight_pattern_change: "Weight is far from this farmer's usual",
      moisture_pattern_change: "Moisture is far from this farmer's usual",
    },
    audit: "Change history",
    auditCreated: "Entry created",
    auditChanged: "Status changed",
    auditBy: "by",
    reviewNote: "Manager's note",
    review: {
      title: "Manager review",
      intro: "Approve, hold or reject. Every change is recorded in the history. Weights and amounts cannot be changed.",
      approve: "Approve",
      hold: "Hold",
      reject: "Reject",
      note: "Reason",
      notePlaceholder: "At least 5 characters (required to hold or reject)",
      needNote: "Write a reason (at least 5 characters).",
      done: "Change saved.",
      failed: "Could not save the change.",
      locked: "This entry is in a payment run and can no longer be changed.",
      operatorReadOnly: "Only office managers can change approval.",
    },
    showing: "Showing",
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
