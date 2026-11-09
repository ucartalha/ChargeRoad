import { useEffect, useState } from 'react';
import { catalogueRequest } from '../../api/catalogue';

type QueryState<T> = {
  path: string | null;
  revision: number;
  data: T | null;
  loading: boolean;
  error: string | null;
};

export function useCatalogueQuery<T>(path: string | null, revision = 0) {
  const [state, setState] = useState<QueryState<T>>({
    path: null, revision: -1, data: null, loading: false, error: null,
  });

  useEffect(() => {
    if (!path) return;
    let active = true;
    const controller = new AbortController();
    setState({ path, revision, data: null, loading: true, error: null });
    catalogueRequest<T>(path, controller.signal).then(
      (data) => { if (active) setState({ path, revision, data, loading: false, error: null }); },
      () => {
        if (active) setState({
          path, revision, data: null, loading: false,
          error: 'Bilgiler yüklenemedi. Bağlantını kontrol edip tekrar dene.',
        });
      },
    );
    return () => { active = false; controller.abort(); };
  }, [path, revision]);

  if (!path) return { data: null, loading: false, error: null };
  // A late result for a previous make/model must never appear under the new selection.
  if (state.path !== path || state.revision !== revision)
    return { data: null, loading: true, error: null };
  return state;
}
