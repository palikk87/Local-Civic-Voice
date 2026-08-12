import { useCurrentUser, useAuthUI } from "@/hooks/use-civic-auth";
import { Button } from "@/components/ui/button";
import { ArrowRight, Zap, Users, TrendingUp, Shield, BookOpen, MessageCircle } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Landing() {
  const { isAuthenticated, isLoading } = useCurrentUser();
  const { openAuth } = useAuthUI();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/feed", { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  // Show a minimal screen while checking auth state
  if (isLoading || isAuthenticated) {
    return (
      <div className="min-h-screen w-full bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-screen opacity-20 blur-3xl animate-blob" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-screen opacity-20 blur-3xl animate-blob animation-delay-2000" />
        <div className="absolute top-1/2 left-1/2 w-80 h-80 bg-blue-400 rounded-full mix-blend-screen opacity-10 blur-3xl animate-blob animation-delay-4000" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Header */}
        <header className="flex items-center justify-between px-4 md:px-8 py-6 md:py-8">
          <div className="flex items-center gap-3 group">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-orange-400 to-orange-600 rounded-2xl blur-lg opacity-75 group-hover:opacity-100 transition-opacity" />
              <div className="relative bg-gradient-to-br from-orange-400 to-orange-600 rounded-2xl p-2">
                <Zap className="w-6 h-6 text-white" />
              </div>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
              Civic Voice
            </h1>
          </div>
          <Button
            onClick={() => openAuth()}
            className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white border-0 px-6 md:px-8 font-semibold rounded-lg transition-all duration-200 shadow-lg hover:shadow-orange-500/50"
          >
            Sign in
          </Button>
        </header>

        {/* Hero Section */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 md:px-8 py-12 md:py-20">
          <div className="max-w-3xl mx-auto text-center space-y-8">
            {/* Main Headline */}
            <div className="space-y-6">
              <h2 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-tight">
                <span className="block text-white">
                  Join the
                </span>
                <span className="block bg-gradient-to-r from-orange-400 via-orange-300 to-yellow-300 bg-clip-text text-transparent">
                  Conversation
                </span>
              </h2>
              <p className="text-lg md:text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed">
                Share your perspective on bills, orders, and rulings shaping the country. Vote, debate, and make your voice heard in the civic process.
              </p>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Button
                onClick={() => openAuth()}
                size="lg"
                className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white border-0 px-8 py-6 text-lg font-semibold rounded-lg shadow-lg hover:shadow-orange-500/50 transition-all duration-200 group"
              >
                Get Started <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="border-2 border-gray-500 hover:border-gray-400 text-white hover:bg-white/10 px-8 py-6 text-lg font-semibold rounded-lg transition-all duration-200"
              >
                Learn More
              </Button>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="relative z-10 px-4 md:px-8 py-12 md:py-20">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
              {/* Feature 1 */}
              <div className="group relative">
                <div className="absolute inset-0 bg-gradient-to-br from-orange-500/20 to-purple-500/20 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 rounded-2xl p-8 transition-all duration-300 group-hover:bg-white/10">
                  <div className="bg-gradient-to-br from-orange-400 to-orange-600 rounded-xl p-3 w-fit mb-4">
                    <MessageCircle className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">
                    Share Your Voice
                  </h3>
                  <p className="text-gray-300 leading-relaxed">
                    Post your thoughts and perspectives on government proposals, legislation, and civic issues.
                  </p>
                </div>
              </div>

              {/* Feature 2 */}
              <div className="group relative">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 rounded-2xl p-8 transition-all duration-300 group-hover:bg-white/10">
                  <div className="bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl p-3 w-fit mb-4">
                    <TrendingUp className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">
                    Track Trends
                  </h3>
                  <p className="text-gray-300 leading-relaxed">
                    See what matters most to your community. Follow trending topics and discover new perspectives.
                  </p>
                </div>
              </div>

              {/* Feature 3 */}
              <div className="group relative">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 rounded-2xl p-8 transition-all duration-300 group-hover:bg-white/10">
                  <div className="bg-gradient-to-br from-purple-400 to-purple-600 rounded-xl p-3 w-fit mb-4">
                    <BookOpen className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">
                    Explore Details
                  </h3>
                  <p className="text-gray-300 leading-relaxed">
                    Deep dive into legislation with full texts, amendments, and comprehensive reference materials.
                  </p>
                </div>
              </div>

              {/* Feature 4 */}
              <div className="group relative">
                <div className="absolute inset-0 bg-gradient-to-br from-green-500/20 to-blue-500/20 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 rounded-2xl p-8 transition-all duration-300 group-hover:bg-white/10">
                  <div className="bg-gradient-to-br from-green-400 to-green-600 rounded-xl p-3 w-fit mb-4">
                    <Shield className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">
                    Cast Your Vote
                  </h3>
                  <p className="text-gray-300 leading-relaxed">
                    Vote on proposals and see how your vote compares to your community's sentiment.
                  </p>
                </div>
              </div>

              {/* Feature 5 */}
              <div className="group relative">
                <div className="absolute inset-0 bg-gradient-to-br from-pink-500/20 to-orange-500/20 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 rounded-2xl p-8 transition-all duration-300 group-hover:bg-white/10">
                  <div className="bg-gradient-to-br from-pink-400 to-pink-600 rounded-xl p-3 w-fit mb-4">
                    <Users className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">
                    Find Delegates
                  </h3>
                  <p className="text-gray-300 leading-relaxed">
                    Discover representatives who align with your values and follow their positions.
                  </p>
                </div>
              </div>

              {/* Feature 6 */}
              <div className="group relative">
                <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/20 to-orange-500/20 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 rounded-2xl p-8 transition-all duration-300 group-hover:bg-white/10">
                  <div className="bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-xl p-3 w-fit mb-4">
                    <Zap className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-3">
                    Real-time Updates
                  </h3>
                  <p className="text-gray-300 leading-relaxed">
                    Stay informed with live updates on bills and government actions as they happen.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Section */}
        <div className="relative z-10 px-4 md:px-8 py-12 md:py-16 border-t border-white/10">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
              <div>
                <p className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
                  1000+
                </p>
                <p className="text-gray-400 mt-2">Active Users</p>
              </div>
              <div>
                <p className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent">
                  50K+
                </p>
                <p className="text-gray-400 mt-2">Votes Cast</p>
              </div>
              <div>
                <p className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-400 to-purple-600 bg-clip-text text-transparent">
                  100+
                </p>
                <p className="text-gray-400 mt-2">Bills Discussed</p>
              </div>
              <div>
                <p className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-pink-400 to-pink-600 bg-clip-text text-transparent">
                  24/7
                </p>
                <p className="text-gray-400 mt-2">Live Updates</p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA Footer */}
        <div className="relative z-10 px-4 md:px-8 py-12 md:py-16">
          <div className="max-w-2xl mx-auto text-center space-y-6">
            <h3 className="text-3xl md:text-4xl font-bold text-white">
              Ready to make an impact?
            </h3>
            <p className="text-lg text-gray-300">
              Join thousands of engaged citizens in shaping the future of our country.
            </p>
            <Button
              onClick={() => openAuth()}
              size="lg"
              className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white border-0 px-8 py-6 text-lg font-semibold rounded-lg shadow-lg hover:shadow-orange-500/50 transition-all duration-200 group"
            >
              Create Your Account <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
        }

        .animate-blob {
          animation: blob 7s infinite;
        }

        .animation-delay-2000 {
          animation-delay: 2s;
        }

        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}</style>
    </div>
  );
}
