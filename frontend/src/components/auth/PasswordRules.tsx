import { Fragment } from 'react';
import { Check } from 'lucide-react';
import { PASSWORD_RULES } from '../../utils/validators';

/**
 * The password's rules, shown before anything is typed (audit 2026-10-08, PUB-20: they used to arrive one at a
 * time after a submit). Each rule gets its tick as the password meets it; after a refused submit the rules still
 * missing are marked. The words are the input's description for screen readers; the ticks are for the eye.
 */
export default function PasswordRules({ id, password, flagged = false }: { id: string; password: string; flagged?: boolean }) {
  return (
    <p id={id} className="au-rules">
      <span className="sr-only">Пароль: </span>
      {PASSWORD_RULES.map((rule, index) => {
        const met = rule.met(password);
        return (
          <Fragment key={rule.id}>
            <span className="au-rule" data-met={met ? '' : undefined} data-missing={flagged && !met ? '' : undefined}>
              <i className="au-rule-mark" aria-hidden="true">
                <Check strokeWidth={3} />
              </i>
              {rule.label}
            </span>
            {index < PASSWORD_RULES.length - 1 ? <span className="sr-only">, </span> : null}
          </Fragment>
        );
      })}
    </p>
  );
}
