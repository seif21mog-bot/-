# نظام ديون سوبرماركت جنة الياسمين

واجهة (GitHub Pages) ← Google Apps Script (Web App) ← Google Sheets. دفتر الحركات (Transactions) هو مصدر الحقيقة، والأرصدة تُحسب منه دائمًا.

## الأمان (مهم)
GitHub Pages لا ينفذ كودًا خلفيًا، والـ Web App يجب نشره بصلاحية "أي شخص" ليقبل الطلبات من موقعك. لذلك الحماية تتم داخل الكود: المستخدم يسجل الدخول بحساب جوجل (Google Sign-In)، والخادم يتحقق من التوكن ومن أن البريد ضمن قائمة `allowedEmails` في ورقة Settings، وإلا يرفض الطلب. لا توجد كلمات سر أو مفاتيح في الواجهة. لا تنشر الشيت للعامة.

## خطوات التشغيل
1. **الشيت:** أنشئ Google Sheet جديدًا (خاص).
2. **Apps Script:** من الشيت: Extensions ← Apps Script. الصق محتوى `Code.gs`، احفظ، ثم شغّل الدالة `setup` ووافق على الصلاحيات (تُنشئ الأوراق Customers/Suppliers/Transactions/Settings).
3. **OAuth Client ID:** في console.cloud.google.com أنشئ مشروعًا ← APIs & Services ← OAuth consent screen (External، أضف بريدك كـ Test user) ← Credentials ← Create OAuth client ID نوع Web application. في Authorized JavaScript origins ضع `https://USERNAME.github.io`. انسخ الـ Client ID.
4. **ورقة Settings:** ضع الـ Client ID في صف `clientId`، وبريد (أو بريدات مفصولة بفاصلة) المسموح لهم في `allowedEmails`.
5. **النشر:** Deploy ← New deployment ← Web app. Execute as: **Me**، Who has access: **Anyone**. انسخ الرابط المنتهي بـ `/exec`. (عند أي تعديل على الكود: Deploy ← Manage deployments ← Edit ← New version.)
6. **الواجهة:** عدّل `config.js` بوضع `API_URL` و `CLIENT_ID`.
7. **GitHub:** أنشئ مستودعًا وارفع `index.html style.css app.js config.js README.md .gitignore` (ملف `Code.gs` اختياري كنسخة). ثم Settings ← Pages ← Branch: main / root.
8. افتح `https://USERNAME.github.io/REPO/` وسجّل الدخول.

## سيناريوهات الاختبار (نفّذها يدويًا بعد النشر)
| السيناريو | النتيجة المتوقعة |
|---|---|
| عميل بدين افتتاحي 1000 ثم دفعة 300 | المتبقي 700، الحالة "مسدد جزئيًا" |
| ثم دفعة 700 | المتبقي 0، "مسدد بالكامل" والحركات باقية |
| مورد 10000 ثم دفع 3000 ثم 7000 | 7000 ثم 0 |
| دين جديد بعد التسوية | يُعاد فتح الحساب تلقائيًا (الرصيد > 0 والحالة "مسدد جزئيًا" لوجود دفعات سابقة) |
| دفعة 0 أو سالبة أو نص أو أكبر من المتبقي | رفض برسالة عربية |
| الضغط مرتين على تأكيد / إعادة المحاولة | حركة واحدة فقط (نفس معرف الطلب) |
| طلبان متزامنان | يُنفَّذان بالتتابع بفضل LockService |
| قطع الإنترنت | رسالة "تعذر الاتصال" دون تسجيل حركة |
| تحديث الصفحة | البيانات من الشيت كما هي |
| حساب جوجل غير مدرج في allowedEmails | يُرفض الدخول |
| التصحيح | زر "عكس" ينشئ حركة عكسية بسبب، ولا يحذف الأصل |

## النسخ الاحتياطي والاستعادة
File ← Make a copy (يوميًا أو أسبوعيًا)، أو File ← Version history ← Name current version. للاستعادة: افتح النسخة، وانسخ كودها أو أعد ربط `API_URL` بنشر جديد، أو استرجع نسخة من Version history.

## ملاحظات
- الأرصدة السالبة (رصيد دائن/سلفة) غير مدعومة: أي حركة تجعل الرصيد أقل من صفر تُرفض.
- تعديل بيانات الحساب لا يغيّر اسم الحساب في الحركات القديمة.
- لا تحذف صفوفًا من ورقة Transactions يدويًا.
