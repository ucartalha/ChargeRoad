import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VehicleCatalogueDetail } from '@chargeroad/shared';
import { cataloguePaths, catalogueRequest, CatalogueApiError } from '../../api/catalogue';

const STORAGE_KEY = 'chargeroad.active-vehicle-id.v1';

export function useActiveVehicle() {
  const [vehicle, setVehicle] = useState<VehicleCatalogueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);

  const restore = useCallback(async () => {
    const version = ++generation.current;
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    setLoading(true);
    setError(null);
    try {
      const id = await AsyncStorage.getItem(STORAGE_KEY);
      if (!id) return;
      if (!/^[a-f0-9]{64}$/.test(id)) {
        await AsyncStorage.removeItem(STORAGE_KEY);
        return;
      }
      const current = await catalogueRequest<VehicleCatalogueDetail>(cataloguePaths.detail(id), requestController.signal);
      if (!mounted.current || generation.current !== version) return;
      if (current.isActive) setVehicle(current);
      else setError('Seçtiğin araç artık katalogda aktif değil. Yeni bir varyant seçebilirsin.');
    } catch (cause) {
      if (mounted.current && generation.current === version) {
        setError(cause instanceof CatalogueApiError && cause.status === 404
          ? 'Seçtiğin araç katalogda bulunamadı. Yeniden araç seçebilirsin.'
          : 'Kayıtlı aracın yüklenemedi. Bağlantını kontrol edip tekrar dene.');
      }
    } finally {
      if (mounted.current && generation.current === version) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void restore();
    return () => { mounted.current = false; controller.current?.abort(); };
  }, [restore]);

  const select = useCallback(async (next: VehicleCatalogueDetail) => {
    // Persist the stable ID only. Specifications are read afresh from our DB on launch.
    await AsyncStorage.setItem(STORAGE_KEY, next.id);
    ++generation.current;
    controller.current?.abort();
    if (mounted.current) {
      setVehicle(next);
      setLoading(false);
      setError(null);
    }
  }, []);

  return { vehicle, loading, error, select, retry: restore };
}
