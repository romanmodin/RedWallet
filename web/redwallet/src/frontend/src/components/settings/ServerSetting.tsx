/**
 * ServerSetting — editable Electrum/Fulcrum server configuration.
 *
 * Host, port, and TLS are edited as a local draft and committed on save so
 * the user can finish typing before anything is persisted. Validation is
 * inline and reachable: the host must be non-empty and the port must be a
 * whole number between 1 and 65535. No server is ever filled in
 * automatically.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Lock, Save, Server } from "lucide-react";
import { useEffect, useState } from "react";

interface ServerSettingProps {
  host: string;
  port: number;
  tls: boolean;
  onSave: (config: { host: string; port: number; tls: boolean }) => void;
}

interface DraftErrors {
  host?: string;
  port?: string;
}

function validate(host: string, portText: string): DraftErrors {
  const errors: DraftErrors = {};
  if (!host.trim()) {
    errors.host = "Enter a server host to connect to.";
  }
  const port = Number(portText);
  if (!portText.trim()) {
    errors.port = "Enter a port number.";
  } else if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.port = "Enter a whole number between 1 and 65535.";
  }
  return errors;
}

export function ServerSetting({ host, port, tls, onSave }: ServerSettingProps) {
  const [draftHost, setDraftHost] = useState(host);
  const [draftPort, setDraftPort] = useState(String(port));
  const [draftTls, setDraftTls] = useState(tls);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saved, setSaved] = useState(false);

  // Re-sync the draft only when the persisted server config changes from
  // outside this form (e.g. a reset), never on every keystroke.
  useEffect(() => {
    setDraftHost(host);
    setDraftPort(String(port));
    setDraftTls(tls);
  }, [host, port, tls]);

  const isDirty =
    draftHost !== host || draftPort !== String(port) || draftTls !== tls;

  const handleSave = () => {
    const nextErrors = validate(draftHost, draftPort);
    setErrors(nextErrors);
    if (nextErrors.host || nextErrors.port) {
      setSaved(false);
      return;
    }
    onSave({
      host: draftHost.trim(),
      port: Number(draftPort),
      tls: draftTls,
    });
    setSaved(true);
  };

  return (
    <div data-ocid="settings.server" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-server-host">Server host</Label>
        <Input
          id="settings-server-host"
          data-ocid="settings.server.host_input"
          value={draftHost}
          onChange={(event) => {
            setDraftHost(event.target.value);
            setSaved(false);
          }}
          placeholder="e.g. electrum.example.org"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={errors.host ? true : undefined}
          aria-describedby={
            errors.host ? "settings-server-host-error" : undefined
          }
          className="font-mono"
        />
        {errors.host ? (
          <p
            id="settings-server-host-error"
            data-ocid="settings.server.host_error"
            className="text-xs font-medium text-destructive"
          >
            {errors.host}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-server-port">Port</Label>
          <Input
            id="settings-server-port"
            data-ocid="settings.server.port_input"
            value={draftPort}
            onChange={(event) => {
              setDraftPort(event.target.value);
              setSaved(false);
            }}
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={errors.port ? true : undefined}
            aria-describedby={
              errors.port ? "settings-server-port-error" : undefined
            }
            className="font-mono"
          />
          {errors.port ? (
            <p
              id="settings-server-port-error"
              data-ocid="settings.server.port_error"
              className="text-xs font-medium text-destructive"
            >
              {errors.port}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-server-tls">Transport security</Label>
          <div
            className={cn(
              "flex min-h-9 items-center justify-between gap-3 rounded-md border border-input bg-input/30 px-3 py-1.5",
            )}
          >
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock className="size-4" aria-hidden="true" />
              {draftTls ? "TLS on" : "TLS off"}
            </span>
            <Switch
              id="settings-server-tls"
              data-ocid="settings.server.tls_switch"
              checked={draftTls}
              onCheckedChange={(checked) => {
                setDraftTls(checked);
                setSaved(false);
              }}
              aria-label="Use TLS for the server connection"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isDirty}
          data-ocid="settings.server.save_button"
          className="rounded-xl bg-gradient-primary text-primary-foreground shadow-card-red transition-smooth hover:brightness-110"
        >
          <Save className="size-4" aria-hidden="true" />
          Save server
        </Button>
        {saved && !isDirty ? (
          <output
            data-ocid="settings.server.saved_state"
            className="text-xs font-medium text-success"
          >
            Server settings saved.
          </output>
        ) : null}
      </div>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Server className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        RedWallet ships with no server configured. Enter the Electrum or Fulcrum
        endpoint you trust — nothing is filled in for you.
      </p>
    </div>
  );
}
