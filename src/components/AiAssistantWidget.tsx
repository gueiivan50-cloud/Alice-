import { MessageSquare, Send, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';

interface AiAssistantWidgetProps {
  brandName: string;
  accentColor: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function AiAssistantWidget({ brandName, accentColor }: AiAssistantWidgetProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: `Bonjour ! Je suis l’assistant commercial de ${brandName}. Je peux vous conseiller des vidéos, vous indiquer les prix en FCFA et vous guider pour le paiement Wave, Orange Money, Mobile Money ou carte bancaire.`,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function sendQuestion(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const updated: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(updated);
    setInput('');
    setLoading(true);

    try {
      const resp = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updated }),
      });
      const data = (await resp.json()) as { reply?: string; error?: string };
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || data.error || 'Une erreur est survenue.',
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Impossible de joindre l’assistant pour le moment.' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendQuestion(input);
  }

  return (
    <>
      {/* Floating CTA Button above mobile nav */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 min-h-[46px] px-4 py-2.5 rounded-xl text-white font-semibold text-xs sm:text-sm shadow-2xl border border-white/20 flex items-center gap-2 transition-transform hover:scale-[1.02] cursor-pointer"
          style={{ backgroundColor: accentColor }}
        >
          <MessageSquare className="w-4 h-4" />
          <span>PARLER À NOTRE ASSISTANT IA</span>
        </button>
      )}

      {/* Assistant Chat Panel */}
      {open && (
        <div
          className="fixed bottom-20 md:bottom-6 right-3 left-3 sm:left-auto sm:w-[400px] z-50 bg-[#121218] border border-white/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[75vh]"
          role="dialog"
          aria-label="Assistant commercial IA"
        >
          <div className="px-4 py-3 bg-[#0C0C10] border-b border-white/10 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">Assistant Commercial IA</h3>
              <p className="text-[11px] text-zinc-400">
                Catalogue en direct · Prix en FCFA · Côte d’Ivoire
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-[36px] min-w-[36px] rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300 cursor-pointer"
              aria-label="Fermer l'assistant"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-xl text-xs sm:text-sm leading-relaxed whitespace-pre-line ${
                  m.role === 'user'
                    ? 'bg-white/15 text-white ml-8'
                    : 'bg-[#1A1A22] border border-white/10 text-zinc-200 mr-6'
                }`}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="p-3 rounded-xl bg-[#1A1A22] border border-white/10 text-xs text-zinc-400 mr-6">
                Consultation du catalogue en cours...
              </div>
            )}
          </div>

          {/* Quick prompts */}
          <div className="px-3 py-2 border-t border-white/10 flex gap-1.5 overflow-x-auto no-scrollbar">
            {['Quels sont vos prix ?', 'Comment payer par Wave ?', 'Des codes promo ?'].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => sendQuestion(q)}
                className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-zinc-300 whitespace-nowrap shrink-0 cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="p-3 border-t border-white/10 flex gap-2 bg-[#0D0D12]">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Posez votre question..."
              className="flex-1 min-h-[40px] px-3 rounded-lg bg-[#16161D] border border-white/10 text-xs sm:text-sm text-white placeholder:text-zinc-500"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="min-h-[40px] min-w-[40px] rounded-lg text-white flex items-center justify-center cursor-pointer disabled:opacity-40"
              style={{ backgroundColor: accentColor }}
              aria-label="Envoyer"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
