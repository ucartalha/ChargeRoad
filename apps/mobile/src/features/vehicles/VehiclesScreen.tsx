import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { VehicleCatalogueDetail, VehicleCatalogueEntry, VehicleCataloguePage } from '@chargeroad/shared';
import { cataloguePaths } from '../../api/catalogue';
import type { CatalogueOption } from '../../api/catalogue';
import { colors as c } from '../../theme';
import { connectorLabel, formatNumber, variantLabel } from './format';
import { useCatalogueQuery } from './useCatalogueQuery';

type Stage = 0 | 1 | 2;
type Item = CatalogueOption | VehicleCatalogueEntry;
type Props = {
  activeVehicle: VehicleCatalogueDetail | null;
  onSelect: (vehicle: VehicleCatalogueDetail) => Promise<void>;
};

const steps = ['Marka', 'Model', 'Varyant'] as const;

export function VehiclesScreen({ activeVehicle, onSelect }: Props) {
  const [stage, setStage] = useState<Stage>(0);
  const [make, setMake] = useState<CatalogueOption | null>(null);
  const [model, setModel] = useState<CatalogueOption | null>(null);
  const [draft, setDraft] = useState<VehicleCatalogueEntry | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [offset, setOffset] = useState(0);
  const [pages, setPages] = useState<{ key: string; items: VehicleCatalogueEntry[]; total: number }>({
    key: '', items: [], total: 0,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const mounted = useRef(true);
  const list = useRef<FlatList<Item>>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const makes = useCatalogueQuery<CatalogueOption[]>(stage === 0 ? cataloguePaths.makes : null, revision);
  const models = useCatalogueQuery<CatalogueOption[]>(
    stage === 1 && make ? cataloguePaths.models(make.slug) : null, revision,
  );
  const scope = JSON.stringify([make?.slug, model?.slug, debouncedSearch]);
  const variants = useCatalogueQuery<VehicleCataloguePage>(
    stage === 2 && make && model
      ? cataloguePaths.variants(make.slug, model.slug, offset)
        + (debouncedSearch ? '&q=' + encodeURIComponent(debouncedSearch) : '')
      : null,
    revision,
  );
  const detail = useCatalogueQuery<VehicleCatalogueDetail>(draft ? cataloguePaths.detail(draft.id) : null, revision);

  useEffect(() => {
    if (!variants.data) return;
    const page = variants.data;
    setPages((previous) => {
      const before = offset === 0 || previous.key !== scope ? [] : previous.items;
      const ids = new Set(before.map((item) => item.id));
      return { key: scope, total: page.total,
        items: [...before, ...page.items.filter((item) => !ids.has(item.id))] };
    });
  }, [variants.data, scope, offset]);

  const resetSearch = () => { setSearch(''); setDebouncedSearch(''); setOffset(0); };
  const jumpTo = (next: Stage) => {
    if (saving || (next === 1 && !make) || (next === 2 && !model)) return;
    setStage(next);
    resetSearch();
    Keyboard.dismiss();
  };
  const selectOption = (item: Item) => {
    if (saving) return;
    Keyboard.dismiss();
    setSaveError(null);
    if ('id' in item) {
      setDraft(item);
    } else if (stage === 0) {
      setMake(item); setModel(null); setDraft(null); setStage(1); resetSearch();
    } else {
      setModel(item); setDraft(null); setStage(2); resetSearch();
    }
    if (!('id' in item)) list.current?.scrollToOffset({ offset: 0, animated: false });
  };
  const commit = async () => {
    if (saving || !detail.data || !detail.data.isActive || detail.data.id !== draft?.id) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSelect(detail.data);
    } catch {
      if (mounted.current) setSaveError('Araç kaydedilemedi. Lütfen tekrar dene.');
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const query = stage === 0 ? makes : stage === 1 ? models : variants;
  const searchPending = stage === 2 && search.trim() !== debouncedSearch;
  const loading = query.loading && (stage !== 2 || offset === 0);
  const filteredOptions = (options: CatalogueOption[] | null) => (options ?? []).filter(
    (item) => item.name.toLocaleLowerCase('tr-TR').includes(search.trim().toLocaleLowerCase('tr-TR')),
  );
  const items: Item[] = stage === 0 ? filteredOptions(makes.data)
    : stage === 1 ? filteredOptions(models.data)
    : pages.key === scope && !searchPending ? pages.items : [];
  const total = stage === 2 ? (pages.key === scope ? pages.total : 0) : items.length;
  const titles = [
    'Hangi markayı kullanıyorsun?',
    make ? make.name + ' modelini seç.' : 'Modelini seç.',
    model ? model.name + ' varyantını seç.' : 'Varyantını seç.',
  ];
  const header = (
    <View>
      <View style={s.intro}>
        <View style={s.kickerRow}>
          <View style={s.kickerDot} /><Text style={s.kicker}>SANA ÖZEL BİR YOLCULUK</Text>
        </View>
        <Text style={s.title}>Önce aracını{'\n'}tanıyalım.</Text>
        <Text style={s.subtitle}>Doğru araç. Daha iyi bir yol planı.</Text>
      </View>

      <View style={s.hero}>
        <View style={s.heroCopy}>
          <View style={s.heroTag}>
            <Ionicons name="flash" size={11} color={c.lime} />
            <Text style={s.heroTagText}>ELEKTRİKLİ GARAJIN</Text>
          </View>
          <Text style={s.heroTitle}>{activeVehicle ? activeVehicle.make + ' ' + activeVehicle.model : 'Her yolculuk\nseninle başlar.'}</Text>
          <Text style={s.heroCaption}>{activeVehicle
            ? variantLabel(activeVehicle) + ' · ' + activeVehicle.modelYear
            : 'Aracını seç, yola bir adım yaklaş.'}</Text>
        </View>
        <View style={s.heroArtwork}>
          <View style={s.orbit} /><View style={s.orbitSmall} />
          <Ionicons name="car-sport-outline" size={88} color={c.lime} />
          <View style={s.roadLine} />
        </View>
      </View>

      <View style={s.progress}>
        {steps.map((name, index) => (
          <Pressable accessibilityRole="button" accessibilityLabel={name + ' seçimi'}
            accessibilityState={{ disabled: saving || (index === 1 && !make) || (index === 2 && !model), selected: stage === index }}
            disabled={saving || (index === 1 && !make) || (index === 2 && !model)}
            key={name} onPress={() => jumpTo(index as Stage)} style={s.progressItem}>
            <View style={[s.stepCircle, stage === index && s.stepCircleActive, index < stage && s.stepCircleDone]}>
              {index < stage ? <Ionicons name="checkmark" size={15} color={c.green} />
                : <Text style={[s.stepNumber, stage === index && s.stepNumberActive]}>{index + 1}</Text>}
            </View>
            <Text style={[s.stepLabel, stage === index && s.stepLabelActive]}>{name}</Text>
            {index < 2 && <View style={s.stepLine} />}
          </Pressable>
        ))}
      </View>

      {(make || model) && (
        <View style={s.breadcrumbs}>
          {make && <Pressable disabled={saving} onPress={() => jumpTo(0)} style={s.crumb}>
            <Text style={s.crumbText}>{make.name}</Text><Ionicons name="chevron-down" size={12} color={c.green} />
          </Pressable>}
          {model && <Pressable disabled={saving} onPress={() => jumpTo(1)} style={s.crumb}>
            <Text style={s.crumbText}>{model.name}</Text><Ionicons name="chevron-down" size={12} color={c.green} />
          </Pressable>}
        </View>
      )}

      <View style={s.sectionRow}>
        <Text style={s.sectionTitle}>{titles[stage]}</Text>
        {!loading && !searchPending && !query.error && <Text style={s.count}>{total}</Text>}
      </View>
      <View style={s.searchBox}>
        <Ionicons name="search-outline" size={19} color={c.muted} />
        <TextInput accessibilityLabel={steps[stage] + ' ara'} value={search} editable={!saving}
          onChangeText={(value) => { setSearch(value); setOffset(0); }}
          placeholder={steps[stage] + ' ara'} placeholderTextColor={c.muted}
          autoCorrect={false} autoCapitalize="none" maxLength={100}
          style={s.searchInput} returnKeyType="search" />
        {!!search && <Pressable accessibilityRole="button" accessibilityLabel="Aramayı temizle"
          disabled={saving} onPress={() => { setSearch(''); setOffset(0); }} hitSlop={10}>
          <Ionicons name="close-circle" size={18} color={c.muted} />
        </Pressable>}
      </View>
      {query.error && (stage !== 2 || offset === 0) && (
        <View style={s.errorBox}>
          <Ionicons name="cloud-offline-outline" size={23} color={c.error} />
          <Text accessibilityRole="alert" style={s.errorText}>{query.error}</Text>
          <Pressable accessibilityRole="button" onPress={() => setRevision((value) => value + 1)} style={s.retryButton}>
            <Text style={s.retryText}>Tekrar dene</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  const footer = (
    <View>
      {stage === 2 && pages.key === scope && pages.items.length < pages.total && !loading && (
        <Pressable accessibilityRole="button" disabled={variants.loading || saving || searchPending}
          onPress={() => variants.error ? setRevision((value) => value + 1) : setOffset(pages.items.length)} style={s.loadMore}>
          {variants.loading ? <ActivityIndicator color={c.green} /> : <Text style={s.loadMoreText}>{variants.error ? 'Yüklenemedi · Tekrar dene' : 'Diğer varyantları göster'}</Text>}
        </Pressable>
      )}
      <View style={s.sourceNote}>
        <Ionicons name="information-circle-outline" size={15} color={c.muted} />
        <Text style={s.sourceText}>Model yılı ve batarya kapasitesini aracınla karşılaştırarak seç.</Text>
      </View>
    </View>
  );

  return (
    <View style={s.screen}>
      <FlatList<Item> ref={list} key={stage} numColumns={stage === 0 ? 2 : 1}
        data={loading || searchPending ? [] : items}
        keyExtractor={(item) => 'id' in item ? item.id : item.sourceKey + ':' + item.slug}
        contentContainerStyle={s.listContent}
        columnWrapperStyle={stage === 0 ? s.gridRow : undefined}
        ListHeaderComponent={header} ListFooterComponent={footer}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={loading || searchPending
          ? <View style={s.loading}><ActivityIndicator color={c.green} /><Text style={s.loadingText}>Seçenekler yükleniyor…</Text></View>
          : query.error ? undefined : <View style={s.empty}>
            <Ionicons name="search-outline" size={28} color={c.muted} />
            <Text style={s.emptyTitle}>{search ? 'Eşleşen sonuç yok' : 'Henüz seçenek bulunmuyor'}</Text>
            <Text style={s.emptyCopy}>{search ? 'Farklı bir kelimeyle tekrar ara.' : 'Başka bir seçim yapabilir veya tekrar deneyebilirsin.'}</Text>
          </View>}
        renderItem={({ item }) => {
          if (!('id' in item)) {
            return (
              <Pressable accessibilityRole="button" accessibilityLabel={item.name + ' seç'}
                disabled={saving} onPress={() => selectOption(item)}
                style={({ pressed }) => [stage === 0 ? s.brandCard : s.modelCard, pressed && s.pressed]}>
                <View style={[s.monogram, stage !== 0 && s.modelMonogram]}>
                  {stage === 0 ? <Text style={s.monogramText}>{item.name.slice(0, 2).toUpperCase()}</Text>
                    : <Ionicons name="car-outline" size={25} color={c.green} />}
                </View>
                <View style={s.optionCopy}>
                  <Text style={s.optionName}>{item.name}</Text>
                  <Text style={s.optionCaption}>{stage === 0 ? 'Modelleri keşfet' : 'Varyantları görüntüle'}</Text>
                </View>
                <Ionicons name="arrow-forward" size={17} color={c.green} style={stage === 0 ? s.brandArrow : undefined} />
              </Pressable>
            );
          }
          const selected = draft?.id === item.id;
          return (
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: saving }}
              accessibilityLabel={variantLabel(item) + ', ' + item.modelYear + ', ' + formatNumber(item.usableBatteryKwh, 'kWh')}
              disabled={saving} onPress={() => selectOption(item)}
              style={({ pressed }) => [s.variantCard, selected && s.variantSelected, pressed && s.pressed]}>
              <View style={s.variantTop}>
                <View style={s.optionCopy}>
                  <Text style={s.variantName}>{variantLabel(item)}</Text>
                  <Text style={s.optionCaption}>{item.make} {item.model}</Text>
                </View>
                <Text style={s.yearBadge}>{item.modelYear}</Text>
                <View style={[s.radio, selected && s.radioSelected]}>
                  {selected && <Ionicons name="checkmark" size={13} color={c.surface} />}
                </View>
              </View>
              <View style={s.variantSpecs}>
                <View style={s.inlineSpec}><Ionicons name="battery-half-outline" size={16} color={c.green} />
                  <Text style={s.specValue}>{formatNumber(item.usableBatteryKwh, 'kWh')}</Text></View>
                <View style={s.specDivider} />
                <View style={s.inlineSpec}><Ionicons name="flash-outline" size={15} color={c.green} />
                  <Text style={s.specValue}>{formatNumber(item.maxDcChargeKw, 'kW DC')}</Text></View>
              </View>
              {item.connectorTypes.length > 0 && <Text style={s.connectorText}>{item.connectorTypes.map(connectorLabel).join(' · ')}</Text>}
            </Pressable>
          );
        }}
      />
      {stage === 2 && draft && (
        <View style={s.selectionFooter}>
          <View style={s.selectedCopy}>
            <Text style={s.selectedEyebrow}>SEÇİLEN ARAÇ</Text>
            <Text style={s.selectedTitle} numberOfLines={1}>{draft.make} {draft.model}</Text>
            <Text style={s.selectedSubtitle}>{variantLabel(draft)} · {draft.modelYear}</Text>
          </View>
          {detail.error && <View style={s.detailError}>
            <Text accessibilityRole="alert" style={s.saveError}>Araç ayrıntıları yüklenemedi.</Text>
            <Pressable accessibilityRole="button" onPress={() => setRevision((value) => value + 1)}>
              <Text style={s.retryText}>Tekrar dene</Text>
            </Pressable>
          </View>}
          {detail.data && !detail.data.isActive && <Text style={s.saveError}>Bu varyant artık aktif değil. Başka bir seçenek seç.</Text>}
          {saveError && <Text accessibilityRole="alert" style={s.saveError}>{saveError}</Text>}
          <Pressable accessibilityRole="button"
            disabled={saving || detail.loading || !detail.data?.isActive || detail.data.id !== draft.id}
            onPress={() => void commit()} style={({ pressed }) => [s.confirmButton,
              (saving || detail.loading || !detail.data?.isActive) && s.disabled, pressed && s.pressed]}>
            {saving || detail.loading ? <ActivityIndicator color={c.ink} />
              : <><Text style={s.confirmText}>Bu araçla devam et</Text><Ionicons name="arrow-forward" size={20} color={c.ink} /></>}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  listContent: { paddingHorizontal: 22, paddingBottom: 24 },
  intro: { paddingTop: 24, marginBottom: 20 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  kickerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.orange },
  kicker: { fontSize: 9, fontWeight: '800', letterSpacing: 1.8, color: c.muted },
  title: { color: c.ink, fontSize: 35, lineHeight: 39, fontWeight: '800', letterSpacing: -1.3 },
  subtitle: { color: c.muted, fontSize: 13, marginTop: 10 },
  hero: { borderRadius: 24, backgroundColor: c.ink, minHeight: 160, padding: 21, flexDirection: 'row', overflow: 'hidden' },
  heroCopy: { flex: 1, zIndex: 1 },
  heroTag: { flexDirection: 'row', gap: 5, alignItems: 'center', marginBottom: 15 },
  heroTagText: { color: c.lime, fontSize: 8, fontWeight: '800', letterSpacing: 1.1 },
  heroTitle: { color: c.surface, fontSize: 21, lineHeight: 27, fontWeight: '700', maxWidth: 210 },
  heroCaption: { color: '#B9CDC0', fontSize: 10, lineHeight: 16, marginTop: 8, maxWidth: 190 },
  heroArtwork: { width: 100, alignItems: 'center', justifyContent: 'center', marginLeft: -12 },
  orbit: { position: 'absolute', width: 180, height: 180, borderRadius: 90, borderColor: '#365A4B', borderWidth: 1 },
  orbitSmall: { position: 'absolute', width: 135, height: 135, borderRadius: 70, borderColor: '#365A4B', borderWidth: 1 },
  roadLine: { width: 76, height: 2, backgroundColor: '#648362', marginTop: -15 },
  progress: { flexDirection: 'row', marginTop: 24, marginBottom: 20 },
  progressItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepCircle: { width: 27, height: 27, borderRadius: 14, backgroundColor: '#E7ECE5', alignItems: 'center', justifyContent: 'center' },
  stepCircleActive: { backgroundColor: c.ink },
  stepCircleDone: { backgroundColor: c.lime },
  stepNumber: { color: c.muted, fontSize: 11, fontWeight: '700' },
  stepNumberActive: { color: c.lime },
  stepLabel: { color: c.muted, fontSize: 11, fontWeight: '600' },
  stepLabelActive: { color: c.ink, fontWeight: '800' },
  stepLine: { height: 1, flex: 1, backgroundColor: '#D6DED3', marginRight: 8, minWidth: 3 },
  breadcrumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 17 },
  crumb: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: c.softGreen, flexDirection: 'row', alignItems: 'center', gap: 9 },
  crumbText: { color: c.green, fontSize: 11, fontWeight: '600' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  sectionTitle: { color: c.ink, fontSize: 16, fontWeight: '700', flex: 1 },
  count: { color: c.muted, fontSize: 11, backgroundColor: '#E8EDE5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  searchBox: { minHeight: 48, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line, paddingHorizontal: 14, marginBottom: 16 },
  searchInput: { flex: 1, color: c.ink, fontSize: 13, paddingVertical: 12 },
  gridRow: { gap: 12 },
  brandCard: { flex: 1, maxWidth: '50%', minHeight: 134, padding: 16, backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.line, marginBottom: 12 },
  monogram: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#EFF3EB', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  monogramText: { color: c.green, fontWeight: '800', fontSize: 15, letterSpacing: -0.5 },
  modelMonogram: { marginBottom: 0, width: 46, height: 46 },
  modelCard: { flexDirection: 'row', gap: 13, alignItems: 'center', backgroundColor: c.surface, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: c.line, marginBottom: 10 },
  optionCopy: { flex: 1 },
  optionName: { color: c.ink, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  optionCaption: { color: c.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  brandArrow: { position: 'absolute', right: 14, top: 20 },
  variantCard: { backgroundColor: c.surface, padding: 17, borderRadius: 18, borderWidth: 1.5, borderColor: c.line, marginBottom: 10 },
  variantSelected: { borderColor: c.green, backgroundColor: '#F0F6E8' },
  variantTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  variantName: { color: c.ink, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  yearBadge: { color: c.green, fontSize: 10, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: '#EAF0E5', borderRadius: 8, fontWeight: '600' },
  radio: { width: 21, height: 21, borderRadius: 11, borderWidth: 1.5, borderColor: '#CCD6C7', alignItems: 'center', justifyContent: 'center' },
  radioSelected: { backgroundColor: c.green, borderColor: c.green },
  variantSpecs: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' },
  inlineSpec: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  specValue: { color: c.green, fontSize: 11, fontWeight: '600' },
  specDivider: { width: 1, height: 13, backgroundColor: '#D9E1D4' },
  connectorText: { color: c.muted, fontSize: 10, marginTop: 10 },
  pressed: { opacity: 0.7 },
  loading: { minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: c.muted, fontSize: 12 },
  empty: { alignItems: 'center', paddingVertical: 30, gap: 10 },
  emptyTitle: { color: c.ink, fontWeight: '700', fontSize: 15 },
  emptyCopy: { color: c.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  sourceNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingVertical: 18 },
  sourceText: { flex: 1, color: c.muted, fontSize: 10, lineHeight: 16 },
  errorBox: { backgroundColor: c.errorSurface, borderRadius: 16, padding: 16, alignItems: 'center', gap: 10, marginBottom: 14 },
  errorText: { color: c.error, textAlign: 'center', fontSize: 12, lineHeight: 18 },
  retryButton: { paddingVertical: 8, paddingHorizontal: 16 },
  retryText: { fontSize: 12, fontWeight: '700', color: c.green },
  loadMore: { alignItems: 'center', padding: 15, borderWidth: 1, borderColor: c.line, borderRadius: 14, marginTop: 4 },
  loadMoreText: { color: c.green, fontSize: 12, fontWeight: '700' },
  selectionFooter: { paddingHorizontal: 22, paddingTop: 14, paddingBottom: 12, backgroundColor: c.surface, borderTopWidth: 1, borderColor: c.line },
  selectedCopy: { marginBottom: 12 },
  selectedEyebrow: { color: c.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1.5 },
  selectedTitle: { color: c.ink, fontSize: 16, fontWeight: '700', marginTop: 4 },
  selectedSubtitle: { color: c.muted, fontSize: 10, marginTop: 3 },
  confirmButton: { minHeight: 50, borderRadius: 15, backgroundColor: c.lime, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  confirmText: { color: c.ink, fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  saveError: { color: c.error, fontSize: 11, lineHeight: 17, marginBottom: 8 },
  detailError: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
});
