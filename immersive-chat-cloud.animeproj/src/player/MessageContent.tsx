import { useMemo } from 'react';
import type { RegexScript } from '@seachat/sdk/render/render';
import { formatMessageHtml } from './message-display.ts';

export function MessageContent({
  text,
  regexScripts,
  className,
  typing,
  role = 'assistant',
}: {
  text: string;
  regexScripts?: readonly RegexScript[] | null;
  className?: string;
  /** Append typing caret styling on the rich body. */
  typing?: boolean;
  role?: 'user' | 'assistant' | 'system';
}) {
  const html = useMemo(
    () => formatMessageHtml(text, { regexScripts: regexScripts ?? undefined, role }),
    [text, regexScripts, role],
  );

  if (!text) return null;

  return (
    <div
      className={[
        'message-formatted',
        role === 'user' ? 'is-user' : 'is-character',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        className={typing ? 'message-formatted-body typing' : 'message-formatted-body'}
        // HTML is produced by formatMessageHtml → sanitizeDisplayHtml.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
