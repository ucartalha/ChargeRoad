import {StyleSheet,Text,View} from 'react-native';
import Slider from '@react-native-community/slider';
import {colors as c} from '../../theme';
export function ChargeSlider({label,value,onChange,hint}:{label:string;value:string;onChange:(value:string)=>void;hint:string}){
  const number=value===''?0:Number(value.replace(',','.'));
  return <View style={s.container}>
    <View style={s.row}><Text style={s.label}>{label}</Text><Text style={s.value}>{value===''?'Seç':`%${value}`}</Text></View>
    <Slider testID={label==='Başlangıç şarjı'?'starting-charge-slider':label==='Minimum yol rezervi'?'reserve-charge-slider':label==='Hedef varış şarjı'?'arrival-charge-slider':'navigation-charge-slider'}
      accessibilityLabel={label} accessibilityValue={{min:0,max:100,now:number,text:value===''?'Henüz seçilmedi':`Yüzde ${value}`}}
      minimumValue={0} maximumValue={100} step={1} value={number} onValueChange={next=>onChange(String(Math.round(next)))} onSlidingComplete={next=>onChange(String(Math.round(next)))}
      minimumTrackTintColor={c.green} maximumTrackTintColor="#E5EBE7" thumbTintColor={c.green} style={s.slider}/>
    <View style={s.row}><Text style={s.hint}>0%</Text><Text style={s.hint}>{hint}</Text><Text style={s.hint}>100%</Text></View>
  </View>;
}
const s=StyleSheet.create({container:{gap:5},row:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},label:{color:c.ink,fontSize:13,fontWeight:'600'},value:{color:c.green,fontSize:22,fontWeight:'800',letterSpacing:-1},slider:{height:36,marginHorizontal:-10},hint:{fontSize:10,color:c.muted}});
