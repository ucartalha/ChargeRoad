import {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Linking,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import * as Location from 'expo-location';
import type {LocationResult,LocationSearchResponse} from '@chargeroad/shared';
import {planningApi,PlanningApiError} from '../../api/planning';
import {colors as c} from '../../theme';
type Props={label:string;value:LocationResult|null;onChange:(value:LocationResult|null)=>void;deviceLocation?:boolean};
export function LocationPicker({label,value,onChange,deviceLocation}:Props){
  const [query,setQuery]=useState(value?.label??''),[response,setResponse]=useState<LocationSearchResponse|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[cooldown,setCooldown]=useState(0);
  const [attribution,setAttribution]=useState<{text:string;url:string}|null>(null);
  const generation=useRef(0),active=useRef<AbortController|null>(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;active.current?.abort();};},[]);
  useEffect(()=>{if(value)setQuery(value.label);},[value?.id,value?.label]);
  useEffect(()=>{if(cooldown<=0)return;const timer=setInterval(()=>setCooldown(v=>Math.max(0,v-1)),1000);return()=>clearInterval(timer);},[cooldown>0]);
  const cancel=()=>{generation.current++;active.current?.abort();setBusy(false);setResponse(null);setError('');};
  async function search(){if(busy||cooldown>0||query.trim().length<3)return;cancel();const version=generation.current,controller=new AbortController();active.current=controller;setBusy(true);
    try{const data=await planningApi.search(query.trim(),controller.signal);if(alive.current&&generation.current===version){setResponse(data);setAttribution({text:data.attribution,url:data.attributionUrl});}}
    catch(cause){if(alive.current&&generation.current===version){setError(cause instanceof Error?cause.message:'Adres araması tamamlanamadı.');if(cause instanceof PlanningApiError)setCooldown(cause.retryAfterSeconds);}}
    finally{if(alive.current&&generation.current===version)setBusy(false);}}
  async function locate(){if(busy)return;cancel();const version=generation.current;setBusy(true);let timer:ReturnType<typeof setTimeout>|undefined;
    try{const permission=await Location.requestForegroundPermissionsAsync();if(!alive.current||generation.current!==version)return;
      if(permission.status!=='granted')throw new Error('Konum izni verilmedi. Başlangıç adresini arayarak devam edebilirsin.');
      const position=await Promise.race([Location.getCurrentPositionAsync({accuracy:Location.Accuracy.Balanced}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Konum alınamadı. Açık alanda tekrar dene veya adres ara.')),12000);})]);
      if(!alive.current||generation.current!==version)return;
      const accuracy=position.coords.accuracy;if(accuracy===null||accuracy>500)throw new Error('Konum doğruluğu yetersiz. Başlangıç adresini arayarak seçebilirsin.');
      const next={id:'device-location',label:`Mevcut konum (±${Math.ceil(accuracy)} m)`,coordinate:{latitude:position.coords.latitude,longitude:position.coords.longitude}};
      setAttribution(null);setQuery(next.label);onChange(next);
    }catch(cause){if(alive.current&&generation.current===version)setError(cause instanceof Error?cause.message:'Konum alınamadı; adres arayarak devam edebilirsin.');}
    finally{if(timer)clearTimeout(timer);if(alive.current&&generation.current===version)setBusy(false);}}
  return <View style={s.box}>
    <Text style={s.label}>{label}</Text>
    <View style={s.row}><TextInput accessibilityLabel={label} placeholder="Şehir, ilçe veya adres ara" placeholderTextColor={c.muted} value={query}
      onChangeText={text=>{cancel();setAttribution(null);setQuery(text);onChange(null);}} onSubmitEditing={()=>void search()} style={s.input} maxLength={120}/>
      <Pressable accessibilityRole="button" disabled={busy||query.trim().length<3||cooldown>0} onPress={()=>void search()} style={s.button}>
        <Text style={s.action}>{cooldown>0?`${cooldown} sn`:'Ara'}</Text></Pressable></View>
    {value&&<Text style={s.selected}>✓ Konum seçildi</Text>}
    {deviceLocation&&<Pressable accessibilityRole="button" disabled={busy} onPress={()=>void locate()}><Text style={s.link}>Mevcut konumumu kullan</Text></Pressable>}
    {busy&&<View style={s.row}><ActivityIndicator color={c.green}/><Text style={s.small}>Konum alınıyor…</Text></View>}
    {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {response&&<View>{response.results.length===0&&<Text style={s.small}>Sonuç bulunamadı. İlçe veya şehir ekleyerek tekrar ara.</Text>}
      {response.results.map(item=><Pressable accessibilityRole="button" key={item.id} onPress={()=>{cancel();setQuery(item.label);onChange(item);}} style={s.result}>
        <Text style={s.resultText}>{item.label}</Text></Pressable>)}
    </View>}
    {attribution&&<Pressable accessibilityRole="link" onPress={()=>void Linking.openURL(attribution.url)}><Text style={s.small}>{attribution.text}</Text></Pressable>}
  </View>;
}
const s=StyleSheet.create({box:{backgroundColor:c.surface,borderWidth:1,borderColor:c.line,borderRadius:16,padding:14,gap:8},
  label:{color:c.muted,fontSize:10,fontWeight:'800',letterSpacing:1},row:{flexDirection:'row',alignItems:'center',gap:10},input:{flex:1,color:c.ink,minHeight:40,fontSize:14},
  button:{padding:10,borderRadius:10,backgroundColor:c.softGreen},action:{color:c.green,fontWeight:'700'},link:{color:c.green,fontSize:12,paddingVertical:6},
  small:{color:c.muted,fontSize:11,lineHeight:17},selected:{color:c.green,fontSize:11},error:{color:c.error,fontSize:12,lineHeight:18},
  result:{paddingVertical:12,borderTopWidth:1,borderColor:c.line},resultText:{color:c.ink,fontSize:13,lineHeight:20}});
