import React, { useState } from "react";
import { FaCalculator, FaImage, FaVideo, FaCoins } from "react-icons/fa";

const Calculator = () => {
  const [amount, setAmount] = useState("");
  const [calculated, setCalculated] = useState(false);
  const [hasCalculatedOnce, setHasCalculatedOnce] = useState(false);
  const [error, setError] = useState("");

  // Pricing constant
  const COST_PER_CREDIT = 0.05; // 0.05 USD per credit

  // Image Models: name -> credits per image
  const imageModels = {
    imagen: { name: "Imagen", creditsPerImage: 1 },
    openai: { name: "OpenAI", creditsPerImage: 7 },
    nanoBanana: { name: "Nano Banana Pro", creditsPerImage: 7 },
  };

  // Video Models: name -> credits per second
  const videoModels = {
    sora2: { name: "Sora 2", creditsPerSecond: 2 },
    veo31fast: { name: "Veo 3.1 fast", creditsPerSecond: 4 },
    veo3: { name: "Veo 3", creditsPerSecond: 5 },
    sora2pro: { name: "Sora 2 Pro", creditsPerSecond: 7 },
    sora2pro4k: { name: "Sora 2 Pro 4K", creditsPerSecond: 10 },
    veo4k: { name: "Veo 4K", creditsPerSecond: 10 },
  };

  const calculateImages = (usdAmount, creditsPerImage) => {
    const totalCredits = usdAmount / COST_PER_CREDIT;
    return Math.floor(totalCredits / creditsPerImage);
  };

  const calculateVideoSeconds = (usdAmount, creditsPerSecond) => {
    const totalCredits = usdAmount / COST_PER_CREDIT;
    return Math.floor(totalCredits / creditsPerSecond);
  };

  const handleCalculate = (e) => {
    if (e) e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) {
      setError("Enter budget");
      setCalculated(false);
      return;
    }
    setError("");
    setCalculated(true);
    setHasCalculatedOnce(true);
  };

  const handleReset = () => {
    setAmount("");
    setCalculated(false);
    setHasCalculatedOnce(false);
    setError("");
  };

  return (
    <div className="w-full min-h-screen bg-[#F8F9FD] p-4 md:p-8 font-sans antialiased text-gray-900">
      <div className="max-w-4xl mx-auto">
        {/* Minimal Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 flex items-center gap-2">
              <span className="p-2 bg-indigo-100 rounded-lg">
                <FaCalculator className="text-indigo-600 text-lg" />
              </span>
              Credit Estimator
            </h1>
            <p className="text-gray-500 text-sm mt-1">Plan your creative budget with precision.</p>
          </div>
          <div className="hidden sm:flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-gray-400 bg-white px-4 py-1.5 rounded-full border border-gray-100">
            <div className="flex items-center gap-1.5 border-r border-gray-100 pr-3">
              <FaCoins className="text-amber-400" />
              $1 = 20 Credits
            </div>
            <div className="flex items-center gap-1.5">
              1 Credit = $0.05
            </div>
          </div>
        </div>

        {/* Action Bar */}
        <div className="bg-white rounded-2xl border border-gray-100 p-1.5 shadow-sm mb-10 flex flex-col sm:flex-row items-center gap-2">
          <div className="relative flex-1 w-full">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span>
            <input
              type="number"
              min="0"
              max="100000000000"
              value={amount}
              onChange={(e) => {
                const val = e.target.value;
                const numVal = parseFloat(val);
                
                // Prevent negative values
                if (numVal < 0) return;
                
                // Cap at 100 Billion
                if (numVal > 100000000000) {
                  setAmount("100000000000");
                  return;
                }
                
                setAmount(val);
                
                if (!val || parseFloat(val) <= 0) {
                  setCalculated(false);
                  return;
                }

                if (hasCalculatedOnce) {
                  setCalculated(true);
                  setError("");
                }
              }}
              placeholder="Enter USD budget..."
              className="w-full pl-8 pr-4 py-3 bg-transparent border-none focus:ring-0 text-gray-900 text-sm placeholder:text-gray-400"
            />
          </div>
          <div className="flex gap-1.5 w-full sm:w-auto">
            <button
              onClick={handleCalculate}
              className="px-6 py-2.5 bg-indigo-200 text-white rounded-xl text-sm font-semibold hover:bg-indigo-300 transition-all shadow-lg shadow-indigo-200"
            >
              Calculate
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2.5 text-gray-400 hover:text-gray-600 transition-colors text-sm font-medium"
            >
              Reset
            </button>
          </div>
        </div>

        {error && <p className="text-red-500 text-xs mt-2 mb-4 px-2">{error}</p>}

        {calculated ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            {/* Image Section - Column Type */}
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div className="flex items-center gap-2 mb-4 border-b border-gray-100 pb-2">
                <FaImage className="text-indigo-500 text-xs" />
                <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-[0.2em]">Image Generation</p>
              </div>
              <div className="space-y-1">
                {Object.entries(imageModels).map(([key, model]) => {
                  const numImages = calculateImages(parseFloat(amount) || 0, model.creditsPerImage);
                  return (
                    <div key={key} className="group flex items-center justify-between py-4 border-b border-gray-50 last:border-0">
                      <div>
                        <p className="text-sm font-semibold text-gray-800 group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{model.name}</p>
                        <p className="text-[11px] text-gray-400 font-medium">{model.creditsPerImage} Credit{model.creditsPerImage > 1 ? 's' : ''}/Image</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-black text-gray-900 leading-none">{numImages.toLocaleString()}</p>
                        <p className="text-[9px] font-bold text-indigo-500 uppercase mt-1 tracking-wider">Images</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Video Section - Column Type */}
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-700">
              <div className="flex items-center gap-2 mb-4 border-b border-gray-100 pb-2">
                <FaVideo className="text-rose-500 text-xs" />
                <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-[0.2em]">Video Generation</p>
              </div>
              <div className="space-y-1">
                {Object.entries(videoModels).map(([key, model]) => {
                  const videoSeconds = calculateVideoSeconds(parseFloat(amount) || 0, model.creditsPerSecond);
                  const mins = Math.floor(videoSeconds / 60);
                  const secs = videoSeconds % 60;
                  return (
                    <div key={key} className="group flex items-center justify-between py-4 border-b border-gray-50 last:border-0">
                      <div>
                        <p className="text-sm font-semibold text-gray-800 group-hover:text-rose-600 transition-colors uppercase tracking-tight">{model.name}</p>
                        <p className="text-[11px] text-gray-400 font-medium">{model.creditsPerSecond} Credits/Sec</p>
                      </div>
                      <div className="text-right">
                        <div className="flex items-baseline justify-end gap-1 leading-none">
                          <p className="text-lg font-black text-gray-900">{videoSeconds.toLocaleString()}s</p>
                          {videoSeconds >= 60 && (
                            <p className="text-[10px] text-gray-400 font-medium">({mins}m {secs}s)</p>
                          )}
                        </div>
                        <p className="text-[9px] font-bold text-rose-500 uppercase mt-1 tracking-wider">Total Duration</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-20 text-center bg-white rounded-3xl border-2 border-dashed border-gray-100">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <FaCalculator className="text-gray-300 text-2xl" />
            </div>
            <h3 className="text-gray-900 font-semibold mb-1">Ready to calculate?</h3>
            <p className="text-gray-400 text-sm">Enter a budget above to see how many creatives you can generate.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Calculator;
