import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, EyeOff, Aperture, Zap, Lock } from "lucide-react";

interface LoginProps {
  onLogin: (credentials: { username: string; password: string }) => void;
}

const Login = ({ onLogin }: LoginProps) => {
  const [credentials, setCredentials] = useState({ username: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credentials.username || !credentials.password) {
      setError("Please enter both username and password");
      return;
    }

    setIsLoading(true);
    setError("");
    
    // Simulate authentication
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (credentials.username === "admin" && credentials.password === "rapidtool") {
      onLogin(credentials);
    } else {
      setError("Invalid credentials. Try admin/rapidtool");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-mesh flex items-center justify-center p-4">
      {/* Background Tech Pattern */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-accent/5 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-gradient-tech blur-3xl opacity-30" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo Section */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 backdrop-blur-sm mb-4">
            <Aperture className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold font-tech bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            RapidTool-Fixture
          </h1>
          <p className="text-muted-foreground mt-1 font-tech text-sm">
            Automated Fixture Designer
          </p>
        </div>

        {/* Login Card */}
        <Card className="tech-glass shadow-tech border-border/50">
          <CardHeader className="text-center">
            <CardTitle className="text-xl font-tech">Welcome Back</CardTitle>
            <CardDescription className="font-tech">
              Sign in to access your 3D workspace
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="font-tech">
                  <Lock className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="username" className="font-tech text-sm font-medium">
                  Username
                </Label>
                <Input
                  id="username"
                  type="text"
                  value={credentials.username}
                  onChange={(e) => setCredentials(prev => ({ ...prev, username: e.target.value }))}
                  className="font-tech tech-transition focus:shadow-glow"
                  placeholder="Enter your username"
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="font-tech text-sm font-medium">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={credentials.password}
                    onChange={(e) => setCredentials(prev => ({ ...prev, password: e.target.value }))}
                    className="font-tech tech-transition focus:shadow-glow pr-10"
                    placeholder="Enter your password"
                    disabled={isLoading}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={isLoading}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full font-tech tech-transition tech-glow"
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin-smooth" />
                    Authenticating...
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    Sign In
                  </div>
                )}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-xs text-muted-foreground font-tech">
                Demo credentials: <span className="text-primary">admin</span> / <span className="text-primary">rapidtool</span>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6 font-tech">
          Powered by advanced 3D rendering technology
        </p>
      </div>
    </div>
  );
};

export default Login;