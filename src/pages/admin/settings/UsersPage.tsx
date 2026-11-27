import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Role } from "../../../../convex/lib/access";
import { CenteredSpinner } from "../../../components/Spinner";
import { errorMessage } from "../../../lib/errors";
import { ROLE_HELP, ROLE_LABELS } from "../../../lib/me";
import list from "../ListPage.module.css";
import styles from "./Settings.module.css";

type Member = FunctionReturnType<typeof api.members.list>[number];

/** The roles an admin can give. The owner is whoever created the company. */
const ASSIGNABLE = ["admin", "office", "driver"] as const satisfies readonly Role[];
type Assignable = (typeof ASSIGNABLE)[number];

function RoleSelect({
  value,
  onChange,
  label,
  className = "input",
}: {
  value: Assignable;
  onChange: (role: Assignable) => void;
  label: string;
  className?: string;
}) {
  return (
    <select
      className={className}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as Assignable)}
    >
      {ASSIGNABLE.map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </select>
  );
}

export function UsersPage() {
  const members = useQuery(api.members.list);
  const setRole = useMutation(api.members.setRole);
  const remove = useMutation(api.members.remove);
  const [error, setError] = useState<string | null>(null);

  if (members === undefined) return <CenteredSpinner />;

  async function attempt(change: () => Promise<unknown>) {
    setError(null);
    try {
      await change();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function confirmRemove(member: Member) {
    if (
      confirm(
        `¿Quitar a ${member.name ?? member.email}? Ya no podrá entrar a la app. Lo que registró se conserva y puedes volver a agregarlo después.`,
      )
    ) {
      void attempt(() => remove({ memberId: member._id }));
    }
  }

  return (
    <div className={`${styles.stack} ${styles.wide}`}>
      <section className={`card ${styles.panel}`}>
        <h2>Agregar usuario</h2>
        <p className={styles.hint}>
          Escribe el correo de su cuenta de Google. Tendrá acceso en cuanto entre a la app con esa
          cuenta; no se le envía ninguna invitación.
        </p>
        <AddUser />
        <ul className={styles.roles}>
          {ASSIGNABLE.map((role) => (
            <li key={role}>
              <strong>{ROLE_LABELS[role]}:</strong> {ROLE_HELP[role]}
            </li>
          ))}
        </ul>
      </section>

      {error && <p className="error-text">{error}</p>}

      <section className={`card ${list.tableCard}`}>
        <table className={list.table}>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Rol</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const fixed = member.role === "owner" || member.isMe;
              return (
                <tr key={member._id}>
                  <td>
                    <div className={list.person}>
                      {member.image ? (
                        <img src={member.image} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <span className={list.avatar}>
                          {(member.name ?? member.email).charAt(0).toUpperCase()}
                        </span>
                      )}
                      <div>
                        <strong>
                          {member.name ?? "Aún no ha entrado"}
                          {member.isMe && " (tú)"}
                        </strong>
                        <span className={styles.subtle}>{member.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    {member.role === "owner" || member.isMe ? (
                      <span title={ROLE_HELP[member.role]}>{ROLE_LABELS[member.role]}</span>
                    ) : (
                      <RoleSelect
                        className={`input ${styles.roleSelect}`}
                        label={`Rol de ${member.name ?? member.email}`}
                        value={member.role}
                        onChange={(role) =>
                          void attempt(() => setRole({ memberId: member._id, role }))
                        }
                      />
                    )}
                  </td>
                  <td>
                    {!fixed && (
                      <div className={list.actions}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => confirmRemove(member)}
                        >
                          Quitar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function AddUser() {
  const add = useMutation(api.members.add);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Assignable>("driver");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await add({ email, role });
      setEmail("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className={styles.addUser}>
        <input
          className="input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="correo@gmail.com"
          aria-label="Correo de Google"
          autoComplete="off"
        />
        <RoleSelect label="Rol" value={role} onChange={setRole} />
        <button type="submit" className="btn btn-primary" disabled={saving || !email.trim()}>
          Agregar
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}
