import React, { useState, useEffect, useRef, useMemo } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import {
  Camera,
  Upload,
  Search,
  Trash2,
  X,
  Check,
  Loader,
  ExternalLink,
  Archive,
  Image as ImageIcon,
  Plus,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Bot,
  Cloud,
  Download,
  LogOut,
  UserCircle,
  Wand2, // Imported Wand icon
} from "lucide-react";

// --- YOUR REAL DATABASE KEYS ---
const firebaseConfig = {
  apiKey: "AIzaSyCj5j6nfOuHPJorbLHv0-CiVmxEwwR-jN8",
  authDomain: "vintage-validator.firebaseapp.com",
  projectId: "vintage-validator",
  storageBucket: "vintage-validator.firebasestorage.app",
  messagingSenderId: "671319569820",
  appId: "1:671319569820:web:e46e5173d3863d30504459",
  measurementId: "G-R77YTECSGG",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = "vintage-validator-v1";

// --- Gemini API Key ---
// I have embedded your key here so you don't need to paste it again.
const GEMINI_API_KEY = "AIzaSyB60QaDus_70qQl8KWC1XlsJuh0ZJj0yUE";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;

// --- AI Logic ---
async function analyzeImagesWithGemini(images, userNotes, currentData = {}) {
  const knownDetails = [];
  if (currentData.title) knownDetails.push(`Title/Type: ${currentData.title}`);
  if (currentData.materials)
    knownDetails.push(`Materials: ${currentData.materials}`);
  if (currentData.era) knownDetails.push(`Era: ${currentData.era}`);

  const contextPrompt =
    knownDetails.length > 0
      ? `The user has already identified the following details (TRUST THESE over your visual estimate if they conflict): ${knownDetails.join(
          ", "
        )}.`
      : "";

  const prompt = `
    You are an expert antique and vintage appraiser.
    
    ${contextPrompt}
    
    Analyze the attached images and the user's notes: "${userNotes}".
    
    Task:
    1. Identify the item precise counts and details.
    2. Look for hallmarks/signatures.
    3. Estimate value based on your internal knowledge of market trends and sold listings.

    Provide a JSON response with:
    - title: Short, descriptive title.
    - materials: Visible materials.
    - era: Estimated era.
    - valuation_low: Conservative estimate (USD number).
    - valuation_high: Optimistic estimate (USD number).
    - reasoning: Brief explanation (max 2 sentences).
    - search_terms: Specific keywords to find EXACT comparables on robust search engines.
    - search_terms_broad: A simplified query (2-4 words MAX) for strict search engines like Ruby Lane/1stDibs.
    - category: The most specific accurate category.
    - sales_blurb: An engaging, professional sales description (2-3 sentences) suitable for the body of an eBay/Etsy listing. Highlight unique features, style, and condition. Do not repeat the title verbatim.
  `;

  const imageParts = images.map((img) => ({
    inlineData: {
      mimeType: "image/jpeg",
      data: img.split(",")[1],
    },
  }));

  const payload = {
    contents: [{ parts: [{ text: prompt }, ...imageParts] }],
    generationConfig: { responseMimeType: "application/json" },
  };

  try {
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok)
      throw new Error(`Gemini API Error: ${response.statusText}`);
    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText) throw new Error("No analysis generated");
    return JSON.parse(resultText);
  } catch (error) {
    console.error("Analysis failed:", error);
    throw error;
  }
}

// --- Image Helper ---
const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        const maxDim = 800;
        if (width > height) {
          if (width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width *= maxDim / height;
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

// --- Link Helper ---
const getMarketplaceLinks = (category, searchTerms, broadTerms) => {
  if (!searchTerms) return [];
  const query = encodeURIComponent(searchTerms);
  const derivedBroadTerms = searchTerms.split(" ").slice(0, 3).join(" ");
  const broadQuery = encodeURIComponent(broadTerms || derivedBroadTerms);
  const cat = (category || "").toLowerCase();

  const links = [
    {
      name: "eBay Sold",
      domain: "ebay.com",
      url: `https://www.ebay.com/sch/i.html?_nkw=${query}&_sacat=0&LH_Sold=1&LH_Complete=1`,
      color: "text-blue-700 bg-blue-50 border-blue-200",
    },
    {
      name: "Google Images",
      domain: "google.com",
      url: `https://www.google.com/search?q=${query}&tbm=isch`,
      color: "text-stone-700 bg-stone-50 border-stone-200",
    },
  ];

  const isJewelry =
    cat.includes("jewelry") ||
    cat.includes("brooch") ||
    cat.includes("ring") ||
    cat.includes("necklace");
  const isDecor =
    cat.includes("furniture") ||
    cat.includes("lighting") ||
    cat.includes("decor") ||
    cat.includes("glass") ||
    cat.includes("pottery");
  const isArt =
    cat.includes("art") ||
    cat.includes("painting") ||
    cat.includes("print") ||
    cat.includes("sculpture");

  if (isJewelry) {
    links.push({
      name: "Ruby Lane",
      url: `https://www.rubylane.com/search?q=${broadQuery}`,
      color: "text-rose-700 bg-rose-50 border-rose-200",
    });
    links.push({
      name: "1stDibs",
      url: `https://www.1stdibs.com/search/?q=${broadQuery}`,
      color: "text-amber-700 bg-amber-50 border-amber-200",
    });
    links.push({
      name: "Etsy",
      url: `https://www.etsy.com/search?q=${query}`,
      color: "text-orange-700 bg-orange-50 border-orange-200",
    });
  } else if (isDecor || isArt) {
    links.push({
      name: "Chairish",
      url: `https://www.chairish.com/search?q=${broadQuery}`,
      color: "text-pink-700 bg-pink-50 border-pink-200",
    });
    links.push({
      name: "1stDibs",
      url: `https://www.1stdibs.com/search/?q=${broadQuery}`,
      color: "text-amber-700 bg-amber-50 border-amber-200",
    });
    if (isArt)
      links.push({
        name: "LiveAuctioneers",
        url: `https://www.liveauctioneers.com/search/?keyword=${broadQuery}&sort=relevance&status=archive`,
        color: "text-stone-800 bg-stone-100 border-stone-300",
      });
  } else {
    links.push({
      name: "Etsy",
      url: `https://www.etsy.com/search?q=${query}`,
      color: "text-orange-700 bg-orange-50 border-orange-200",
    });
  }
  return links;
};

// --- Components ---
const StatusBadge = ({ status }) => {
  const colors = {
    keep: "bg-green-100 text-green-800 border-green-200",
    sell: "bg-blue-100 text-blue-800 border-blue-200",
    maybe: "bg-amber-100 text-amber-800 border-amber-200",
    unprocessed: "bg-stone-100 text-stone-800 border-stone-200",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
        colors[status] || colors.unprocessed
      } uppercase tracking-wide`}
    >
      {status}
    </span>
  );
};

const ItemCard = ({ item, onClick }) => {
  const displayImage =
    item.images && item.images.length > 0 ? item.images[0] : item.image;
  const imageCount = item.images ? item.images.length : item.image ? 1 : 0;

  return (
    <div
      onClick={() => onClick(item)}
      className="group bg-white rounded-xl shadow-sm hover:shadow-md transition-all duration-200 border border-stone-100 overflow-hidden cursor-pointer flex flex-col h-full"
    >
      <div className="relative aspect-square bg-stone-100 overflow-hidden">
        {displayImage ? (
          <img
            src={displayImage}
            alt={item.title || "Item"}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-stone-400">
            <Camera size={48} />
          </div>
        )}

        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
          <StatusBadge status={item.status} />
          {imageCount > 1 && (
            <span className="bg-black/50 backdrop-blur-md text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
              <ImageIcon className="w-3 h-3" /> +{imageCount - 1}
            </span>
          )}
        </div>

        {item.valuation_high > 0 && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8">
            <p className="text-white font-bold text-sm">
              ${item.valuation_low} - ${item.valuation_high}
            </p>
          </div>
        )}
      </div>
      <div className="p-3 flex-1 flex flex-col">
        <h3 className="font-semibold text-stone-800 line-clamp-1 mb-1">
          {item.title || "Untitled Item"}
        </h3>
        <p className="text-xs text-stone-500 line-clamp-2 mb-2 flex-1">
          {item.materials || item.userNotes || "No details yet"}
        </p>
        <div className="flex items-center justify-between text-xs text-stone-400 mt-auto pt-2 border-t border-stone-50">
          <span>{item.category || "Unsorted"}</span>
          {item.era && <span>{item.era}</span>}
        </div>
      </div>
    </div>
  );
};

const LoginScreen = () => {
  const handleGoogleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
      alert("Login failed. Check Authorized Domains in Firebase Console.");
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-gradient-to-br from-stone-50 to-orange-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-stone-100">
        <div className="bg-stone-700 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-stone-200">
          <Wand2 className="w-8 h-8 text-amber-50" />
        </div>
        <h1 className="text-2xl font-bold text-stone-800 mb-2">
          Vintage Validator
        </h1>
        <p className="text-stone-500 mb-8">
          AI-powered inventory and appraisal for your collection.
        </p>

        <button
          onClick={handleGoogleLogin}
          className="w-full bg-stone-800 hover:bg-stone-700 text-white font-bold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-3 mb-4 shadow-md"
        >
          <img
            src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
            className="w-5 h-5"
            alt="G"
          />
          Sign in with Google
        </button>

        <p className="text-[10px] text-stone-400 mt-6">
          Login required to ensure data persistence.
        </p>
      </div>
    </div>
  );
};

const EditModal = ({ item, onClose, onSave, onDelete }) => {
  const [formData, setFormData] = useState({
    ...item,
    images: item.images || (item.image ? [item.image] : []),
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const addPhotoInputRef = useRef(null);
  const marketLinks = useMemo(
    () =>
      getMarketplaceLinks(
        formData.category,
        formData.search_terms,
        formData.search_terms_broad
      ),
    [formData.category, formData.search_terms, formData.search_terms_broad]
  );

  const handleAnalyze = async () => {
    if (formData.images.length === 0) return;
    setIsAnalyzing(true);
    try {
      const analysis = await analyzeImagesWithGemini(
        formData.images,
        formData.userNotes || "",
        formData
      );
      setFormData((prev) => ({
        ...prev,
        ...analysis,
        aiLastRun: new Date().toISOString(),
      }));
    } catch (err) {
      alert("Analysis failed. Please check your Gemini API Key in the code.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAddPhoto = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    const newImages = [];
    for (const file of files) {
      newImages.push(await compressImage(file));
    }
    setFormData((prev) => ({
      ...prev,
      images: [...prev.images, ...newImages],
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white sm:rounded-2xl w-full max-w-5xl h-[100dvh] sm:h-auto sm:max-h-[90vh] overflow-hidden shadow-2xl flex flex-col md:flex-row">
        {/* Left: Image Gallery (Fixed height on mobile, full on desktop) */}
        <div className="w-full md:w-1/2 h-72 md:h-auto bg-stone-900 flex flex-col relative group shrink-0">
          <div className="flex-1 relative flex items-center justify-center overflow-hidden bg-black/20 p-4">
            {formData.images.length > 0 ? (
              <img
                src={formData.images[activeImageIdx]}
                alt="Preview"
                className="max-w-full max-h-full object-contain shadow-2xl"
              />
            ) : (
              <div className="text-white/50 flex flex-col items-center">
                <Camera size={48} />
                <span className="mt-2 text-sm">No images</span>
              </div>
            )}
            {formData.images.length > 1 && (
              <button
                onClick={() => {
                  const ni = formData.images.filter(
                    (_, i) => i !== activeImageIdx
                  );
                  setFormData((p) => ({ ...p, images: ni }));
                  setActiveImageIdx(0);
                }}
                className="absolute top-4 right-4 bg-black/50 hover:bg-red-600 text-white p-2 rounded-full backdrop-blur-md opacity-0 group-hover:opacity-100"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
          <div className="h-24 bg-stone-900 border-t border-white/10 p-3 flex gap-2 overflow-x-auto items-center">
            {formData.images.map((img, idx) => (
              <button
                key={idx}
                onClick={() => setActiveImageIdx(idx)}
                className={`flex-shrink-0 h-16 w-16 rounded-lg overflow-hidden border-2 transition-all ${
                  activeImageIdx === idx
                    ? "border-amber-500 opacity-100"
                    : "border-transparent opacity-50 hover:opacity-100"
                }`}
              >
                <img src={img} className="w-full h-full object-cover" />
              </button>
            ))}
            <button
              onClick={() => addPhotoInputRef.current?.click()}
              className="flex-shrink-0 h-16 w-16 rounded-lg border-2 border-white/10 bg-white/5 hover:bg-white/10 flex flex-col items-center justify-center text-white/50 hover:text-white transition-colors gap-1"
            >
              <Plus size={20} />
              <span className="text-[9px] uppercase font-bold">Add</span>
            </button>
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              ref={addPhotoInputRef}
              onChange={handleAddPhoto}
            />
          </div>
        </div>

        {/* Right: Data Entry (Scrollable) */}
        <div className="w-full md:w-1/2 flex flex-col flex-1 overflow-hidden bg-stone-50 border-l border-stone-200">
          <div className="p-6 border-b border-stone-200 bg-white flex items-center justify-between shrink-0">
            <div>
              <h2 className="text-xl font-bold text-stone-800">Item Details</h2>
              <p className="text-xs text-stone-500">
                {formData.images.length} photos
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (confirm("Delete?")) {
                    onDelete(item.id);
                    onClose();
                  }
                }}
                className="p-2 text-red-500 hover:bg-red-50 rounded-full"
              >
                <Trash2 className="w-5 h-5" />
              </button>
              <button
                onClick={onClose}
                className="p-2 text-stone-400 hover:bg-stone-100 rounded-full"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="flex flex-col gap-4">
              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing || formData.images.length === 0}
                className="w-full flex items-center justify-center gap-2 bg-stone-800 hover:bg-stone-700 text-white py-3 px-4 rounded-xl font-medium transition-colors disabled:opacity-50 shadow-sm"
              >
                {isAnalyzing ? (
                  <>
                    <Loader className="animate-spin w-4 h-4" /> Analyzing...
                  </>
                ) : (
                  <>
                    {formData.aiLastRun ? (
                      <RefreshCw className="w-4 h-4" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    {formData.aiLastRun
                      ? "Re-Run AI Analysis"
                      : "AI Appraise Item"}
                  </>
                )}
              </button>
              <div className="flex bg-white p-1 rounded-lg border border-stone-200 shadow-sm">
                {["keep", "sell", "maybe"].map((status) => (
                  <button
                    key={status}
                    onClick={() => setFormData((prev) => ({ ...prev, status }))}
                    className={`flex-1 py-1.5 text-xs font-bold uppercase rounded-md transition-all ${
                      formData.status === status
                        ? "bg-stone-800 text-white shadow-sm"
                        : "text-stone-500 hover:bg-stone-50"
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>
            {marketLinks.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-stone-500 uppercase tracking-wider flex items-center gap-2">
                    <ExternalLink className="w-3 h-3" /> Market Comps
                  </h4>
                  <span className="text-[10px] text-stone-400 bg-stone-100 px-2 py-0.5 rounded-full truncate max-w-[150px]">
                    {formData.search_terms}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {marketLinks.map((link, i) => (
                    <a
                      key={i}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                      className={`flex items-center justify-between p-3 rounded-xl border transition-all hover:shadow-sm ${link.color}`}
                    >
                      <span className="font-semibold text-sm">{link.name}</span>
                      <ExternalLink className="w-3 h-3 opacity-50" />
                    </a>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider">
                    Title
                  </label>
                  <div className="group relative flex items-center">
                    <Bot className="w-3.5 h-3.5 text-stone-400 cursor-help" />
                    <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block w-max max-w-[200px] px-2 py-1 bg-stone-800 text-white text-[10px] rounded shadow-lg z-50 pointer-events-none">
                      AI makes mistakes, please check
                    </div>
                  </div>
                </div>
                <textarea
                  name="title"
                  rows={2}
                  value={formData.title || ""}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, title: e.target.value }))
                  }
                  className="w-full p-3 bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium resize-none text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    list="category-options"
                    value={formData.category || ""}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, category: e.target.value }))
                    }
                    className="w-full p-3 bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                  />
                  <datalist id="category-options">
                    <option value="Jewelry" />
                    <option value="Art" />
                    <option value="Furniture" />
                    <option value="Lighting" />
                    <option value="Home Decor" />
                    <option value="Glassware" />
                    <option value="Pottery" />
                    <option value="Clothing" />
                    <option value="Other" />
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">
                    Era
                  </label>
                  <input
                    type="text"
                    value={formData.era || ""}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, era: e.target.value }))
                    }
                    className="w-full p-3 bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">
                  Materials
                </label>
                <textarea
                  rows={3}
                  value={formData.materials || ""}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, materials: e.target.value }))
                  }
                  className="w-full p-3 bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm resize-y"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">
                  Sales Blurb
                </label>
                <textarea
                  rows={4}
                  value={formData.sales_blurb || ""}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, sales_blurb: e.target.value }))
                  }
                  placeholder="AI generated sales text will appear here..."
                  className="w-full p-3 bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm resize-y"
                />
              </div>
              <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 relative">
                {formData.aiLastRun && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 bg-white/80 backdrop-blur text-[10px] text-amber-700 px-2 py-0.5 rounded-full border border-amber-100 shadow-sm">
                    <AlertCircle className="w-3 h-3" /> Draft
                  </div>
                )}
                <label className="block text-xs font-bold text-emerald-800 uppercase tracking-wider mb-3 text-center">
                  Estimated Value ($)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={formData.valuation_low || ""}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        valuation_low: e.target.value,
                      }))
                    }
                    className="w-full p-2 bg-white border border-emerald-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-center font-bold text-emerald-900"
                  />
                  <span className="text-emerald-300 font-bold">-</span>
                  <input
                    type="number"
                    value={formData.valuation_high || ""}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        valuation_high: e.target.value,
                      }))
                    }
                    className="w-full p-2 bg-white border border-emerald-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-center font-bold text-emerald-900"
                  />
                </div>
              </div>
              {formData.reasoning && (
                <div className="p-4 bg-stone-100 rounded-xl border border-stone-200 text-sm text-stone-600">
                  <span className="font-bold text-stone-700 block mb-1">
                    AI Reasoning:
                  </span>
                  {formData.reasoning}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wider mb-1">
                  Notes / History
                </label>
                <textarea
                  value={formData.userNotes || ""}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, userNotes: e.target.value }))
                  }
                  rows={4}
                  className="w-full p-3 bg-white border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm placeholder:text-stone-400"
                />
              </div>
            </div>
          </div>
          <div className="p-4 bg-white border-t border-stone-200 shrink-0">
            <button
              onClick={() => {
                onSave({
                  ...formData,
                  image: formData.images.length > 0 ? formData.images[0] : null,
                });
                onClose();
              }}
              className="w-full py-3 bg-stone-800 hover:bg-stone-700 text-white font-bold rounded-xl shadow-lg shadow-stone-200 transition-all flex items-center justify-center gap-2"
            >
              <Check className="w-5 h-5" /> Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState("all");
  const [selectedItem, setSelectedItem] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "artifacts", appId, "users", user.uid, "inventory"),
      orderBy("timestamp", "desc")
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setItems(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (error) => console.error(error)
    );
    return () => unsubscribe();
  }, [user]);

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0 || !user) return;
    setIsUploading(true);
    try {
      const compressedImages = [];
      for (const file of files) {
        compressedImages.push(await compressImage(file));
      }
      await addDoc(
        collection(db, "artifacts", appId, "users", user.uid, "inventory"),
        {
          images: compressedImages,
          image: compressedImages[0],
          status: "unprocessed",
          title: "",
          category: "",
          materials: "",
          userNotes: "",
          timestamp: serverTimestamp(),
          valuation_low: 0,
          valuation_high: 0,
        }
      );
    } catch (error) {
      console.error(error);
    }
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUpdateItem = async (updatedItem) => {
    if (user)
      await updateDoc(
        doc(
          db,
          "artifacts",
          appId,
          "users",
          user.uid,
          "inventory",
          updatedItem.id
        ),
        (({ id, ...data }) => data)(updatedItem)
      );
  };
  const handleDeleteItem = async (itemId) => {
    if (user)
      await deleteDoc(
        doc(db, "artifacts", appId, "users", user.uid, "inventory", itemId)
      );
  };

  const handleExportCSV = () => {
    if (items.length === 0) return;
    const headers = [
      "Title",
      "Category",
      "Era",
      "Materials",
      "Low Estimate",
      "High Estimate",
      "Notes",
      "Status",
    ];
    const rows = items.map((item) => [
      `"${(item.title || "").replace(/"/g, '""')}"`,
      `"${(item.category || "").replace(/"/g, '""')}"`,
      `"${(item.era || "").replace(/"/g, '""')}"`,
      `"${(item.materials || "").replace(/"/g, '""')}"`,
      item.valuation_low || 0,
      item.valuation_high || 0,
      `"${(item.userNotes || "").replace(/"/g, '""')}"`,
      item.status,
    ]);
    const csvContent = [
      headers.join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");
    const link = document.createElement("a");
    link.setAttribute(
      "href",
      URL.createObjectURL(
        new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      )
    );
    link.setAttribute(
      "download",
      `vintage_inventory_${new Date().toISOString().split("T")[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredItems = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.status === filter)),
    [items, filter]
  );
  const totalLowEst = useMemo(
    () =>
      filteredItems.reduce(
        (acc, curr) => acc + (Number(curr.valuation_low) || 0),
        0
      ),
    [filteredItems]
  );
  const totalHighEst = useMemo(
    () =>
      filteredItems.reduce(
        (acc, curr) => acc + (Number(curr.valuation_high) || 0),
        0
      ),
    [filteredItems]
  );

  if (!user) return <LoginScreen />;

  return (
    <div className="min-h-screen bg-stone-50 font-sans text-stone-900 pb-20">
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-stone-700 p-2 rounded-lg text-white">
              <Wand2 className="w-5 h-5 text-amber-50" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-stone-700 via-stone-600 to-stone-800 hidden sm:block">
              Vintage Validator
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex flex-col items-end mr-2">
              <span className="text-[10px] text-stone-400 font-semibold uppercase tracking-wider flex items-center gap-1">
                <Cloud className="w-3 h-3" /> Synced
              </span>
              <span className="text-sm font-bold text-emerald-600 font-mono">
                ${totalLowEst.toLocaleString()} - $
                {totalHighEst.toLocaleString()}
              </span>
            </div>
            <button
              onClick={handleExportCSV}
              disabled={items.length === 0}
              className="p-2 text-stone-400 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
            >
              <Download className="w-5 h-5" />
            </button>
            {/* USER PROFILE & LOGOUT SECTION */}
            <div className="h-8 w-px bg-stone-200 mx-1"></div>
            <div className="flex items-center gap-2">
              <div className="hidden lg:block text-right leading-tight">
                <div className="text-xs font-bold text-stone-700">
                  {user.displayName}
                </div>
                <div className="text-[10px] text-stone-500">{user.email}</div>
              </div>
              <button
                onClick={() => signOut(auth)}
                className="group relative"
                title="Sign Out / Switch Account"
              >
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt="Profile"
                    className="w-9 h-9 rounded-full border-2 border-white shadow-sm transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center border-2 border-white shadow-sm">
                    <UserCircle className="w-5 h-5 text-stone-400" />
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 border border-stone-100 shadow-sm">
                  <LogOut className="w-3 h-3 text-stone-400 group-hover:text-red-500" />
                </div>
              </button>
            </div>
            {/* END USER PROFILE */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="bg-stone-800 hover:bg-stone-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-md flex items-center gap-2 ml-2"
            >
              {isUploading ? (
                <Loader className="animate-spin w-4 h-4" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">Add Item</span>
            </button>
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8">
          <div className="flex items-center bg-white p-1 rounded-xl shadow-sm border border-stone-200 w-full sm:w-auto overflow-x-auto">
            {["all", "keep", "sell", "maybe", "unprocessed"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize whitespace-nowrap transition-all ${
                  filter === f
                    ? "bg-stone-800 text-white"
                    : "text-stone-500 hover:bg-stone-50"
                }`}
              >
                {f}{" "}
                <span className="text-xs opacity-60 ml-1">
                  ({items.filter((i) => f === "all" || i.status === f).length})
                </span>
              </button>
            ))}
          </div>
          <div className="text-xs text-stone-400">
            {filteredItems.length} Items Found
          </div>
        </div>
        {items.length === 0 && !isUploading && (
          <div className="text-center py-20">
            <div className="bg-stone-100 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 text-stone-300">
              <Camera size={48} />
            </div>
            <h3 className="text-lg font-bold text-stone-700 mb-2">
              Start Your Inventory
            </h3>
            <p className="text-stone-500 max-w-md mx-auto mb-8">
              Upload multiple photos of a single jewelry piece or artwork to
              begin.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-stone-800 hover:bg-stone-700 text-white px-6 py-3 rounded-xl font-medium shadow-lg shadow-stone-200 transition-all inline-flex items-center gap-2"
            >
              <Upload className="w-5 h-5" /> Upload Photos
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filteredItems.map((item) => (
            <ItemCard key={item.id} item={item} onClick={setSelectedItem} />
          ))}
        </div>
      </main>
      {selectedItem && (
        <EditModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onSave={handleUpdateItem}
          onDelete={handleDeleteItem}
        />
      )}
    </div>
  );
}
