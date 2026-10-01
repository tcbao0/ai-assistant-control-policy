"use client";

import { Bot, CheckCircle2, CircleAlert, ImagePlus, Loader2, Send, ShieldCheck, UserRound, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { explorerTxUrl } from "@/lib/public-env";
import { notifyVaultBalancesChanged } from "@/lib/vault-events";
import { useOwnerWorkspace } from "@/components/dashboard/use-owner-workspace";
import { MAX_BILL_IMAGE_BYTES } from "@/lib/invoice-image";

type DecisionSource = "ai" | "server" | "chain";
type Preview = {
  recipientName: string;
  recipientAddress: string;
  amountMist: string;
  source: "vault";
  grantId: string;
};
type Prepared = {
  status: "ready" | "clarify" | "rejected";
  action?: "transfer";
  proposalId?: string;
  preview?: Preview;
  message: string;
  reasonSource?: "ai" | "server";
};
type Confirmed = {
  status: "submitted" | "confirmed" | "failed" | "rejected";
  txDigest?: string;
  message: string;
  reasonSource?: "server" | "chain";
};
type ChatLine = {
  id: string;
  author: "user" | "agent";
  text: string;
  source?: DecisionSource;
  status?: Prepared["status"] | Confirmed["status"];
  txDigest?: string;
};
type ChatProposal = {
  proposalId: string;
  action: "subscription" | "transfer";
  grantId: string;
  recipientName: string;
  recipientAddress: string;
  amountMist: string;
  state: string;
  txDigest: string | null;
  errorMessage: string | null;
  expiresAt: string;
  createdAt: string;
};

function suiAmount(mist: string): string {
  try {
    const value = BigInt(mist);
    const decimal = (value % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
    return `${value / 1_000_000_000n}${decimal ? `.${decimal}` : ""}`;
  } catch {
    return mist;
  }
}

function sourceLabel(source?: DecisionSource): string | null {
  if (source === "ai") return "AI decision";
  if (source === "server") return "Server validation";
  if (source === "chain") return "Sui Move contract";
  return null;
}

async function responseBody<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export function AgentChat() {
  const [mode, setMode] = useState<"command" | "bill-text" | "bill-image">("command");
  const [message, setMessage] = useState("");
  const [billText, setBillText] = useState("");
  const [billImage, setBillImage] = useState<File | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState<"prepare" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatProposal[]>([]);
  const [historyEnabled, setHistoryEnabled] = useState(true);
  const { workspace } = useOwnerWorkspace();
  const retryRequest = useRef<{ kind: "command" | "bill"; key: string; id: string } | null>(null);

  function requestId(kind: "command" | "bill", key: string): string {
    if (retryRequest.current?.kind === kind && retryRequest.current.key === key) return retryRequest.current.id;
    const id = crypto.randomUUID();
    retryRequest.current = { kind, key, id };
    return id;
  }

  const refreshHistory = useCallback(async () => {
    const response = await fetch("/api/chat", { cache: "no-store" });
    if (response.status === 401) {
      setHistoryEnabled(false);
      throw new Error("Sign in required");
    }
    const result = await responseBody<{ proposals: ChatProposal[] }>(response);
    setHistory(result.proposals);
  }, []);
  useEffect(() => {
    if (!workspace?.vaultId || !historyEnabled) return;
    void refreshHistory().catch(() => undefined);
  }, [workspace?.vaultId, historyEnabled, refreshHistory]);
  const pendingHistory = history.some((item) => item.state === "submitted" || item.state === "signing");
  useEffect(() => {
    if (!pendingHistory || !historyEnabled || !workspace?.vaultId) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void refreshHistory().catch(() => undefined);
    };
    const timer = window.setInterval(tick, 10_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [pendingHistory, historyEnabled, workspace?.vaultId, refreshHistory]);

  async function prepare() {
    const command = message.trim();
    if (!command || busy) return;
    setBusy("prepare");
    setError(null);
    setPrepared(null);
    setLines((previous) => [...previous, { id: crypto.randomUUID(), author: "user", text: command }]);
    setMessage("");
    try {
      const result = await responseBody<Prepared>(await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: command, requestId: requestId("command", command) }),
      }));
      retryRequest.current = null;
      if (result.status === "ready" && result.proposalId && result.preview) {
        setPrepared(result);
      } else {
        setLines((previous) => [...previous, {
          id: crypto.randomUUID(), author: "agent", text: result.message,
          status: result.status, source: result.reasonSource,
        }]);
      }
      void refreshHistory().catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function prepareBill() {
    if (busy) return;
    if (mode === "bill-text" && !billText.trim()) return;
    if (mode === "bill-image" && !billImage) return;
    setBusy("prepare");
    setError(null);
    setPrepared(null);
    const label = mode === "bill-image" ? `Bill image: ${billImage?.name ?? "bill"}` : billText.trim();
    setLines((previous) => [...previous, { id: crypto.randomUUID(), author: "user", text: label }]);
    try {
      let response: Response;
      if (mode === "bill-image") {
        const digest = await crypto.subtle.digest("SHA-256", await billImage!.arrayBuffer());
        const imageKey = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const form = new FormData();
        form.set("requestId", requestId("bill", `image:${imageKey}`));
        form.set("image", billImage!);
        response = await fetch("/api/chat/bill", { method: "POST", body: form });
      } else {
        const invoice = billText.trim();
        response = await fetch("/api/chat/bill", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestId: requestId("bill", `text:${invoice}`), invoiceRaw: invoice }),
        });
      }
      const result = await response.json() as Prepared & { error?: string };
      retryRequest.current = null;
      if (!response.ok && !result.status) throw new Error(result.error ?? "Could not read bill");
      if (result.status === "ready" && result.proposalId && result.preview) setPrepared(result);
      else setLines((previous) => [...previous, { id: crypto.randomUUID(), author: "agent",
        text: result.message ?? result.error ?? "Bill cannot be paid under the current grant.",
        status: result.status ?? "rejected", source: result.reasonSource ?? "server" }]);
      void refreshHistory().catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function confirm(proposalId?: string) {
    const selectedId = proposalId ?? prepared?.proposalId;
    if (!selectedId || busy) return;
    setBusy("confirm");
    setError(null);
    try {
      const response = await fetch("/api/chat/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId: selectedId }),
      });
      const result = await response.json() as Confirmed & { error?: string };
      if (!result.status || !["submitted", "confirmed", "failed", "rejected"].includes(result.status)) {
        throw new Error(result.error ?? "Could not confirm the request");
      }
      setLines((previous) => [...previous, {
        id: crypto.randomUUID(), author: "agent", text: result.message,
        status: result.status, source: result.reasonSource, txDigest: result.txDigest,
      }]);
      setPrepared(null);
      void refreshHistory().catch(() => undefined);
      if (result.status === "confirmed" || result.status === "submitted") notifyVaultBalancesChanged();
    } catch (cause) {
      // Keep the same proposal so a retry can reconcile any transaction already submitted.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const recent = history.slice(0, 3);
  const reviewPanel = prepared?.preview ? <div className="space-y-3 rounded-xl border border-amber-400/35 bg-amber-400/10 p-4 text-sm">
        <div className="flex items-center gap-2 font-semibold text-amber-100"><ShieldCheck className="h-4 w-4" /> Review agent proposal</div>
        <p className="text-slate-200">{prepared.message}</p>
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[140px_1fr]">
          <dt className="text-slate-400">Action</dt><dd>Whitelisted command payment</dd>
          <dt className="text-slate-400">Recipient</dt><dd>{prepared.preview.recipientName || "Approved recipient"}</dd>
          <dt className="text-slate-400">Sui address</dt><dd className="break-all font-mono text-xs">{prepared.preview.recipientAddress}</dd>
          <dt className="text-slate-400">Amount</dt><dd className="font-semibold">{suiAmount(prepared.preview.amountMist)} SUI</dd>
          <dt className="text-slate-400">Source</dt><dd>Shared vault</dd>
        </dl>
        <p className="text-xs text-amber-100/80">Confirming asks the agent to submit this payment. Move checks the grant on chain.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void confirm()} disabled={!!busy}><CheckCircle2 className="h-4 w-4" /> {busy === "confirm" ? "Submitting…" : "Confirm agent action"}</Button>
          <Button variant="outline" disabled={!!busy} onClick={() => { setPrepared(null); setError(null); }}><XCircle className="h-4 w-4" /> Cancel</Button>
        </div>
      </div> : null;

  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
  <Card className="flex min-h-[70vh] flex-col overflow-hidden border-indigo-400/25 bg-slate-950/90">
    <CardHeader className="border-b border-slate-800/80 bg-gradient-to-r from-indigo-500/10 to-cyan-500/5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300"><Bot className="h-5 w-5" /></div>
        <div>
          <CardTitle>Ask the agent</CardTitle>
          <CardDescription>Pay a command-whitelist name. Review, then confirm.</CardDescription>
        </div>
      </div>
    </CardHeader>
    <CardContent className="flex flex-1 flex-col space-y-4 pt-5">
      {!workspace?.transferGrantId && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
        Create a command grant on{" "}
        <Link href="/policies" className="font-semibold underline">Policies</Link>
        {" "}before chatting.
      </p>}

      <div aria-live="polite" className="min-h-48 flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/70 p-3">
        {lines.length === 0 && <div className="space-y-2 text-sm text-slate-400">
          <p className="font-medium text-slate-200">Try a clear instruction</p>
          <p>“Thanh toán Spotify 1 SUI.”</p>
          <p>“Transfer 0.1 SUI to An.”</p>
          <p>The agent asks for clarification or declines instructions that do not match your approved grants.</p>
        </div>}
        {lines.map((line) => <div key={line.id} className={`flex gap-2 ${line.author === "user" ? "justify-end" : "justify-start"}`}>
          {line.author === "agent" && <Bot className="mt-1 h-4 w-4 shrink-0 text-indigo-300" />}
          <div className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${line.author === "user" ? "bg-indigo-600 text-white" : line.status === "rejected" || line.status === "failed" ? "border border-rose-500/30 bg-rose-500/10 text-rose-100" : "border border-slate-700 bg-slate-900 text-slate-100"}`}>
            <p className="whitespace-pre-wrap break-words">{line.text}</p>
            {sourceLabel(line.source) && <p className="mt-1 text-xs opacity-70">Decision: {sourceLabel(line.source)}</p>}
            {line.txDigest && <a className="mt-1 block break-all text-xs text-indigo-200 underline" href={explorerTxUrl(line.txDigest)} target="_blank" rel="noreferrer">View Sui transaction {line.txDigest}</a>}
          </div>
          {line.author === "user" && <UserRound className="mt-1 h-4 w-4 shrink-0 text-indigo-300" />}
        </div>)}
        {busy === "prepare" && <p className="flex items-center gap-2 text-sm text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> Checking your request and grants…</p>}
      </div>

      <div className="lg:hidden">{reviewPanel}</div>

      {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Agent request type">
        <Button type="button" variant={mode === "command" ? "default" : "outline"} onClick={() => setMode("command")}>Chat command</Button>
        <Button type="button" variant={mode === "bill-text" ? "default" : "outline"} onClick={() => setMode("bill-text")}>Bill text</Button>
        <Button type="button" variant={mode === "bill-image" ? "default" : "outline"} onClick={() => setMode("bill-image")}><ImagePlus className="h-4 w-4" /> Bill image</Button>
      </div>
      {mode === "command" ? <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void prepare(); }}>
        <label htmlFor="agent-command" className="text-sm font-medium">Your instruction</label>
        <Textarea id="agent-command" value={message} maxLength={500} onChange={(event) => setMessage(event.target.value)} placeholder="Thanh toán Spotify 1 SUI, or transfer 0.1 SUI to An…" className="min-h-24" />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400">Only names and addresses registered in the on-chain grant can receive vault funds.</p>
          <Button type="submit" disabled={!!busy || !message.trim() || !!prepared}><Send className="h-4 w-4" /> Check instruction</Button>
        </div>
      </form> : <div className="space-y-3">
        {mode === "bill-text" ? <>
          <label htmlFor="bill-text" className="text-sm font-medium">Paste bill or invoice text</label>
          <Textarea id="bill-text" value={billText} maxLength={20_000} onChange={(event) => setBillText(event.target.value)} placeholder="Paste the merchant, amount, and payment details…" className="min-h-32" />
        </> : <>
          <label htmlFor="bill-image" className="text-sm font-medium">Choose a PNG, JPEG, or WebP bill (up to 8 MB)</label>
          <input id="bill-image" type="file" accept="image/png,image/jpeg,image/webp" className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-2 file:text-white" onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            retryRequest.current = null;
            if (file && (!(["image/png", "image/jpeg", "image/webp"].includes(file.type)) || file.size > MAX_BILL_IMAGE_BYTES)) {
              setBillImage(null);
              setError("Choose a PNG, JPEG, or WebP image no larger than 8 MB");
              return;
            }
            setError(null);
            setBillImage(file);
          }} />
          {billImage && <p className="break-all text-xs text-slate-400">Selected {billImage.name}. The image is not saved in the invoice history.</p>}
        </>}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400">The agent matches the bill to the command whitelist and shows a review before submitting.</p>
          <Button type="button" disabled={!!busy || !!prepared || (mode === "bill-text" ? !billText.trim() : !billImage)} onClick={() => void prepareBill()}><Send className="h-4 w-4" /> Read and review bill</Button>
        </div>
      </div>}
      <div className="lg:hidden space-y-2 border-t border-slate-800 pt-4">
        {recent.map((item) => (
          <HistoryRow key={item.proposalId} item={item} busy={busy} prepared={!!prepared} onReview={setPrepared} onConfirm={confirm} />
        ))}
      </div>
    </CardContent>
  </Card>
  <aside className="hidden space-y-4 lg:block">
    {reviewPanel ?? (
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 text-sm text-slate-400">
        Proposals to confirm appear here after you check an instruction.
      </div>
    )}
    <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-white">Recent</h4>
        <Button variant="ghost" size="sm" onClick={() => void refreshHistory().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}>Refresh</Button>
      </div>
      {recent.length === 0 ? <p className="text-sm text-slate-400">No agent requests yet.</p> : (
        <div className="space-y-2">{recent.map((item) => (
          <HistoryRow key={item.proposalId} item={item} busy={busy} prepared={!!prepared} onReview={setPrepared} onConfirm={confirm} />
        ))}</div>
      )}
    </div>
  </aside>
  </div>;
}

function HistoryRow({
  item, busy, prepared, onReview, onConfirm,
}: {
  item: ChatProposal;
  busy: "prepare" | "confirm" | null;
  prepared: boolean;
  onReview: (next: Prepared) => void;
  onConfirm: (proposalId?: string) => Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-xs">
      <p className="font-medium text-slate-100">Pay · {item.recipientName} · {suiAmount(item.amountMist)} SUI</p>
      <p className="mt-1 text-slate-400">{new Date(item.createdAt).toLocaleString()} · {item.state}</p>
      {item.errorMessage && <p className="mt-1 text-rose-300">{item.errorMessage}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {item.state === "ready" && item.action === "transfer" && Date.parse(item.expiresAt) > Date.now() && (
          <Button variant="outline" size="sm" disabled={!!busy || prepared} onClick={() => onReview({
            status: "ready", action: "transfer", proposalId: item.proposalId,
            preview: { recipientName: item.recipientName, recipientAddress: item.recipientAddress,
              amountMist: item.amountMist, source: "vault", grantId: item.grantId },
            message: "Review this saved proposal before asking the agent to execute it.", reasonSource: "server",
          })}>Review</Button>
        )}
        {(item.state === "submitted" || item.state === "signing") && (
          <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void onConfirm(item.proposalId)}>Check status</Button>
        )}
        {item.txDigest && <a className="text-indigo-300 underline" href={explorerTxUrl(item.txDigest)} target="_blank" rel="noreferrer">tx</a>}
      </div>
    </div>
  );
}
