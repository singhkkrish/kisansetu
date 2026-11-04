export interface Part4Messages {
  nav: { prices: string };
  prices: {
    title: string;
    intro: string;
    effectiveDate: string;
    showDate: string;
    crop: string;
    grade: string;
    published: string;
    notPublished: string;
    newRate: string;
    correctRate: string;
    version: string;
    perQuintal: string;
    stateDraft: string;
    statePublished: string;
    stateCorrection: string;
    stateEmpty: string;
    discard: string;
    saveDrafts: string;
    saving: string;
    reviewPublish: string;
    nothingToPublish: string;
    draftsHidden: string;
    lockedNote: string;
    reasonLabel: string;
    reasonHint: string;
    savedOk: string;
    publishedOk: string;
    discardedOk: string;
    failed: string;
    needRate: string;
    history: string;
    confirmTitle: string;
    confirmIntro: string;
    confirmCorrection: string;
    confirmCheck: string;
    confirmPublish: string;
    publishing: string;
    cancel: string;
    by: string;
    at: string;
    reason: string;
  };
  history: {
    title: string;
    intro: string;
    from: string;
    to: string;
    crop: string;
    allCrops: string;
    apply: string;
    clear: string;
    empty: string;
    date: string;
    rate: string;
    status: string;
    createdBy: string;
    publishedBy: string;
    publishedAt: string;
    reason: string;
    audit: string;
    backToBoard: string;
    limit: string;
    error: string;
    statusLabels: { draft: string; published: string; superseded: string };
    actions: { created: string; edited: string; draft_deleted: string; published: string; superseded: string };
  };
  priceStatus: {
    title: string;
    effective: string;
    version: string;
    published: string;
    none: string;
    synced: string;
    offlineCopy: string;
    stale: string;
    downloadedAt: string;
    neverDownloaded: string;
    newerNote: string;
  };
  wizardPrice: {
    effective: string;
    version: string;
    fromPhone: string;
    changedTitle: string;
    changedBody: string;
    useNew: string;
    keepOld: string;
  };
  slip: {
    show: string;
    hide: string;
    print: string;
    languages: { both: string; mr: string; en: string };
    forFarmer: string;
    printHint: string;
    unpaidNote: string;
  };
  sms: {
    title: string;
    preview: string;
    to: string;
    noPhone: string;
    encoding: string;
    parts: string;
    characters: string;
    send: string;
    queue: string;
    simulate: string;
    simulateHint: string;
    statusTitle: string;
    queued: string;
    queuedWaitingEntry: string;
    sending: string;
    sent: string;
    delivered: string;
    failed: string;
    unavailable: string;
    reasons: Record<string, string>;
    retry: string;
    lastUpdate: string;
    offlineQueued: string;
    managerTitle: string;
    managerNone: string;
    recorded: string;
    attempts: string;
  };
}

const mr: Part4Messages = {
  nav: { prices: "दर" },
  prices: {
    title: "दैनिक दर फलक",
    intro: "सर्व केंद्रांसाठी एकच जाहीर दर. प्रकाशित केलेला दर बदलता येत नाही; चूक असल्यास नवीन आवृत्ती कारणासह करा.",
    effectiveDate: "लागू दिनांक",
    showDate: "दाखवा",
    crop: "पीक",
    grade: "ग्रेड",
    published: "प्रकाशित दर",
    notPublished: "अजून प्रकाशित नाही",
    newRate: "नवीन दर",
    correctRate: "दुरुस्त दर",
    version: "आवृत्ती",
    perQuintal: "प्रति क्विंटल",
    stateDraft: "मसुदा",
    statePublished: "प्रकाशित",
    stateCorrection: "दुरुस्ती मसुदा",
    stateEmpty: "दर नाही",
    discard: "मसुदा रद्द करा",
    saveDrafts: "मसुदा म्हणून जतन करा",
    saving: "जतन करत आहे…",
    reviewPublish: "तपासा आणि प्रकाशित करा",
    nothingToPublish: "प्रकाशित करण्यासाठी मसुदा नाही.",
    draftsHidden: "मसुदे केंद्र ऑपरेटरना दिसत नाहीत.",
    lockedNote: "प्रकाशित दर बदलता येत नाही. दुरुस्ती करण्यासाठी नवीन दर लिहा आणि कारण द्या.",
    reasonLabel: "दुरुस्तीचे कारण",
    reasonHint: "उदा. बाजारभाव दुपारनंतर बदलला (किमान 5 अक्षरे)",
    savedOk: "मसुदे जतन झाले.",
    publishedOk: "दर प्रकाशित झाले. सर्व केंद्रांना पुढील सिंकमध्ये मिळतील.",
    discardedOk: "मसुदा रद्द केला.",
    failed: "हे करता आले नाही. तपशील तपासून पुन्हा प्रयत्न करा.",
    needRate: "किमान एक दर लिहा.",
    history: "दरांचा इतिहास",
    confirmTitle: "हे दर प्रकाशित करायचे?",
    confirmIntro: "प्रकाशित झाल्यावर हे दर सर्व केंद्रे वापरतील आणि बदलता येणार नाहीत.",
    confirmCorrection: "दुरुस्ती",
    confirmCheck: "मी हे दर तपासले आहेत",
    confirmPublish: "प्रकाशित करा",
    publishing: "प्रकाशित करत आहे…",
    cancel: "रद्द करा",
    by: "द्वारे",
    at: "वेळ",
    reason: "कारण",
  },
  history: {
    title: "दरांचा इतिहास",
    intro: "सर्व आवृत्त्या, कोणी तयार केल्या आणि कोणी प्रकाशित केल्या.",
    from: "पासून",
    to: "पर्यंत",
    crop: "पीक",
    allCrops: "सर्व पिके",
    apply: "फिल्टर लावा",
    clear: "फिल्टर काढा",
    empty: "या फिल्टरसाठी दर नाहीत.",
    date: "लागू दिनांक",
    rate: "दर",
    status: "स्थिती",
    createdBy: "तयार केले",
    publishedBy: "प्रकाशित केले",
    publishedAt: "प्रकाशित वेळ",
    reason: "दुरुस्तीचे कारण",
    audit: "बदलांचा इतिहास",
    backToBoard: "दर फलकाकडे",
    limit: "फक्त नवीनतम 300 आवृत्त्या दाखवल्या आहेत.",
    error: "दर लोड करता आले नाहीत.",
    statusLabels: { draft: "मसुदा", published: "प्रकाशित", superseded: "नवीन आवृत्तीने बदलला" },
    actions: {
      created: "तयार केला",
      edited: "मसुदा बदलला",
      draft_deleted: "मसुदा रद्द केला",
      published: "प्रकाशित केला",
      superseded: "नवीन आवृत्तीने बदलला",
    },
  },
  priceStatus: {
    title: "फोनवरील जाहीर दर",
    effective: "लागू दिनांक",
    version: "आवृत्ती",
    published: "प्रकाशित",
    none: "या दिनांकाचा दर या फोनवर नाही.",
    synced: "अद्ययावत: सर्व्हरवरून नुकतेच उतरवले",
    offlineCopy: "ऑफलाइन: फोनवर जतन केलेला दर वापरत आहात",
    stale: "जुना: नेटवर्क आल्यावर नवीन दर घ्या",
    downloadedAt: "उतरवले",
    neverDownloaded: "अजून उतरवलेले नाही",
    newerNote: "नवीन दर प्रकाशित झाल्यास आधी केलेल्या नोंदी बदलत नाहीत.",
  },
  wizardPrice: {
    effective: "लागू दिनांक",
    version: "आवृत्ती",
    fromPhone: "फोनवरील जतन दर",
    changedTitle: "नवीन दर उतरवला गेला आहे",
    changedBody: "ग्रेड निवडल्यानंतर ₹{new} (आवृत्ती {newVersion}) हा दर आला. ही नोंद ₹{old} (आवृत्ती {oldVersion}) वरच राहील, तुम्ही बदलला नाही तर.",
    useNew: "नवीन दर वापरा",
    keepOld: "जुना दर ठेवला आहे",
  },
  slip: {
    show: "पावती दाखवा",
    hide: "पावती लपवा",
    print: "पावती छापा",
    languages: { both: "मराठी + English", mr: "मराठी", en: "English" },
    forFarmer: "शेतकऱ्याला दाखवा",
    printHint: "छापताना फक्त पावती छापली जाते.",
    unpaidNote: "पेमेंट स्थिती नोंदीच्या वेळची आहे.",
  },
  sms: {
    title: "शेतकऱ्याला एसएमएस",
    preview: "एसएमएस पूर्वदृश्य",
    to: "प्रति",
    noPhone: "या शेतकऱ्याचा फोन क्रमांक नोंदलेला नाही, म्हणून एसएमएस पाठवता येत नाही.",
    encoding: "एन्कोडिंग",
    parts: "भाग",
    characters: "अक्षरे",
    send: "एसएमएस पाठवा",
    queue: "एसएमएस रांगेत ठेवा",
    simulate: "वितरण अयशस्वी होण्याचे अनुकरण करा (चाचणी)",
    simulateHint: "हा डमी एसएमएस सेवेचा चाचणी पर्याय आहे.",
    statusTitle: "एसएमएस स्थिती",
    queued: "रांगेत: अजून पाठवलेला नाही",
    queuedWaitingEntry: "रांगेत: ही नोंद सर्व्हरवर पोहोचल्यावर पाठवला जाईल",
    sending: "पाठवत आहे…",
    sent: "एसएमएस सेवेकडे पाठवला. पोहोचल्याची पुष्टी अजून नाही.",
    delivered: "पोहोचला (सेवेने पुष्टी केली)",
    failed: "पोहोचला नाही",
    unavailable: "एसएमएस पाठवता येत नाही",
    reasons: {
      simulated_failure: "चाचणीसाठी अनुकरण केलेले अपयश",
      number_unreachable: "क्रमांक पोहोचण्यायोग्य नाही",
      invalid_number: "क्रमांक चुकीचा आहे",
      gateway_down: "एसएमएस सेवा उपलब्ध नाही",
      unknown_receipt: "सेवेकडून अज्ञात उत्तर",
      no_phone: "फोन क्रमांक नाही",
      invalid_phone: "फोन क्रमांक चुकीचा आहे",
      no_connection: "नेटवर्क नाही",
    },
    retry: "पुन्हा पाठवा",
    lastUpdate: "शेवटचा बदल",
    offlineQueued: "ऑफलाइन आहात. एसएमएस फोनवर रांगेत आहे आणि नोंद सिंक झाल्यावर पाठवला जाईल.",
    managerTitle: "शेतकऱ्याला पाठवलेला एसएमएस",
    managerNone: "या नोंदीसाठी एसएमएस पाठवलेला नाही.",
    recorded: "नोंदवले",
    attempts: "प्रयत्न",
  },
};

const en: Part4Messages = {
  nav: { prices: "Prices" },
  prices: {
    title: "Daily price board",
    intro: "One published rate for every centre. A published rate cannot be edited; to correct it, save a new version with a reason.",
    effectiveDate: "Effective date",
    showDate: "Show",
    crop: "Crop",
    grade: "Grade",
    published: "Published rate",
    notPublished: "Not published yet",
    newRate: "New rate",
    correctRate: "Corrected rate",
    version: "Version",
    perQuintal: "per quintal",
    stateDraft: "Draft",
    statePublished: "Published",
    stateCorrection: "Correction draft",
    stateEmpty: "No rate",
    discard: "Discard draft",
    saveDrafts: "Save as draft",
    saving: "Saving…",
    reviewPublish: "Review and publish",
    nothingToPublish: "There are no drafts to publish.",
    draftsHidden: "Drafts are not visible to centre operators.",
    lockedNote: "A published rate cannot be edited. To correct it, enter the new rate and give a reason.",
    reasonLabel: "Reason for the correction",
    reasonHint: "For example: market rate moved after noon (at least 5 characters)",
    savedOk: "Drafts saved.",
    publishedOk: "Rates published. Every centre receives them on its next sync.",
    discardedOk: "Draft discarded.",
    failed: "That did not work. Check the details and try again.",
    needRate: "Enter at least one rate.",
    history: "Price history",
    confirmTitle: "Publish these rates?",
    confirmIntro: "Once published, every centre uses these rates and they cannot be edited.",
    confirmCorrection: "Correction",
    confirmCheck: "I have checked these rates",
    confirmPublish: "Publish",
    publishing: "Publishing…",
    cancel: "Cancel",
    by: "by",
    at: "at",
    reason: "Reason",
  },
  history: {
    title: "Price history",
    intro: "Every version, who created it and who published it.",
    from: "From",
    to: "To",
    crop: "Crop",
    allCrops: "All crops",
    apply: "Apply filters",
    clear: "Clear filters",
    empty: "No prices match these filters.",
    date: "Effective date",
    rate: "Rate",
    status: "Status",
    createdBy: "Created by",
    publishedBy: "Published by",
    publishedAt: "Published at",
    reason: "Correction reason",
    audit: "Change history",
    backToBoard: "Back to the price board",
    limit: "Only the newest 300 versions are shown.",
    error: "Could not load prices.",
    statusLabels: { draft: "Draft", published: "Published", superseded: "Replaced by a newer version" },
    actions: {
      created: "Created",
      edited: "Draft edited",
      draft_deleted: "Draft discarded",
      published: "Published",
      superseded: "Replaced by a newer version",
    },
  },
  priceStatus: {
    title: "Published rates on this phone",
    effective: "Effective date",
    version: "Version",
    published: "Published",
    none: "No rate for this date is on this phone.",
    synced: "Up to date: downloaded from the server recently",
    offlineCopy: "Offline: using the rates saved on this phone",
    stale: "Old copy: download new rates when you have a network",
    downloadedAt: "Downloaded",
    neverDownloaded: "Not downloaded yet",
    newerNote: "If a newer rate is published, entries already recorded are not changed.",
  },
  wizardPrice: {
    effective: "Effective date",
    version: "Version",
    fromPhone: "Rate saved on this phone",
    changedTitle: "A newer rate was downloaded",
    changedBody: "After you chose this grade, ₹{new} (version {newVersion}) arrived. This entry stays at ₹{old} (version {oldVersion}) unless you switch.",
    useNew: "Use the new rate",
    keepOld: "Keeping the earlier rate",
  },
  slip: {
    show: "Show slip",
    hide: "Hide slip",
    print: "Print slip",
    languages: { both: "मराठी + English", mr: "मराठी", en: "English" },
    forFarmer: "Show this to the farmer",
    printHint: "Only the slip is printed.",
    unpaidNote: "Payment status is as at the time of the entry.",
  },
  sms: {
    title: "SMS to the farmer",
    preview: "SMS preview",
    to: "To",
    noPhone: "This farmer has no phone number on file, so an SMS cannot be sent.",
    encoding: "Encoding",
    parts: "parts",
    characters: "characters",
    send: "Send SMS",
    queue: "Queue SMS",
    simulate: "Simulate a failed delivery (testing)",
    simulateHint: "A testing option of the mock SMS service.",
    statusTitle: "SMS status",
    queued: "Queued: not sent yet",
    queuedWaitingEntry: "Queued: will be sent once this entry reaches the server",
    sending: "Sending…",
    sent: "Sent to the SMS service. Delivery is not confirmed yet.",
    delivered: "Delivered (confirmed by the SMS service)",
    failed: "Not delivered",
    unavailable: "SMS cannot be sent",
    reasons: {
      simulated_failure: "Simulated failure, for testing",
      number_unreachable: "Number unreachable",
      invalid_number: "Number is not valid",
      gateway_down: "SMS service unavailable",
      unknown_receipt: "Unrecognised reply from the service",
      no_phone: "No phone number",
      invalid_phone: "Phone number is not valid",
      no_connection: "No network",
    },
    retry: "Send again",
    lastUpdate: "Last change",
    offlineQueued: "You are offline. The SMS is queued on this phone and goes out after the entry syncs.",
    managerTitle: "SMS to the farmer",
    managerNone: "No SMS has been sent for this entry.",
    recorded: "Recorded",
    attempts: "Attempts",
  },
};

export function getPart4Messages(lang: "mr" | "en"): Part4Messages {
  return lang === "mr" ? mr : en;
}
