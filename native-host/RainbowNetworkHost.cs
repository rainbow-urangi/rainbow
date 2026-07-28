using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Web.Script.Serialization;

internal static class RainbowNetworkHost
{
    private const int MaxMessageBytes = 1024 * 1024;
    private const string HostVersion = "1.0.0";

    public static void Main()
    {
        Stream input = Console.OpenStandardInput();
        Stream output = Console.OpenStandardOutput();
        byte[] lengthBytes = new byte[4];

        while (ReadExact(input, lengthBytes, 0, lengthBytes.Length))
        {
            int length = BitConverter.ToInt32(lengthBytes, 0);
            if (length < 0 || length > MaxMessageBytes) return;
            byte[] request = new byte[length];
            if (!ReadExact(input, request, 0, request.Length)) return;
            WriteMessage(output, BuildResponse());
        }
    }

    private static Dictionary<string, object> BuildResponse()
    {
        string preferredAddress = ResolvePreferredIpv4();
        List<Dictionary<string, object>> interfaces = ReadIpv4Interfaces();
        Dictionary<string, object> preferred = interfaces.FirstOrDefault(item =>
            String.Equals(Convert.ToString(item["address"]), preferredAddress, StringComparison.Ordinal));

        return new Dictionary<string, object>
        {
            { "ok", true },
            { "native_host_version", HostVersion },
            { "preferred_ipv4", preferredAddress },
            { "preferred_interface", preferred == null ? null : preferred["name"] },
            { "confidence", String.IsNullOrEmpty(preferredAddress) ? "unavailable" : "high" },
            { "ipv4_interfaces", interfaces }
        };
    }

    private static string ResolvePreferredIpv4()
    {
        try
        {
            using (Socket socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp))
            {
                socket.Connect(new IPEndPoint(IPAddress.Parse("8.8.8.8"), 53));
                IPEndPoint endpoint = socket.LocalEndPoint as IPEndPoint;
                return endpoint == null ? null : endpoint.Address.ToString();
            }
        }
        catch
        {
            return null;
        }
    }

    private static List<Dictionary<string, object>> ReadIpv4Interfaces()
    {
        List<Dictionary<string, object>> result = new List<Dictionary<string, object>>();
        foreach (NetworkInterface item in NetworkInterface.GetAllNetworkInterfaces())
        {
            IPInterfaceProperties properties;
            try { properties = item.GetIPProperties(); }
            catch { continue; }

            foreach (UnicastIPAddressInformation address in properties.UnicastAddresses)
            {
                if (address.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                string value = address.Address.ToString();
                if (value.StartsWith("127.") || value.StartsWith("169.254.")) continue;
                result.Add(new Dictionary<string, object>
                {
                    { "name", item.Name },
                    { "address", value },
                    { "prefix_length", PrefixLength(address.IPv4Mask) },
                    { "interface_type", item.NetworkInterfaceType.ToString() },
                    { "operational_status", item.OperationalStatus.ToString() },
                    { "virtual", IsVirtual(item) }
                });
            }
        }
        return result;
    }

    private static bool IsVirtual(NetworkInterface item)
    {
        string text = (item.Name + " " + item.Description).ToLowerInvariant();
        return item.NetworkInterfaceType == NetworkInterfaceType.Loopback ||
            item.NetworkInterfaceType == NetworkInterfaceType.Tunnel ||
            text.Contains("vmware") || text.Contains("virtual") || text.Contains("zerotier") ||
            text.Contains("vpn") || text.Contains("docker") || text.Contains("wsl") ||
            text.Contains("hyper-v") || text.Contains("bluetooth");
    }

    private static int PrefixLength(IPAddress mask)
    {
        if (mask == null) return 0;
        int count = 0;
        foreach (byte value in mask.GetAddressBytes())
        {
            byte current = value;
            for (int index = 0; index < 8; index++)
            {
                count += current & 0x80;
                current <<= 1;
            }
        }
        return count / 128;
    }

    private static bool ReadExact(Stream stream, byte[] buffer, int offset, int count)
    {
        int total = 0;
        while (total < count)
        {
            int read = stream.Read(buffer, offset + total, count - total);
            if (read <= 0) return false;
            total += read;
        }
        return true;
    }

    private static void WriteMessage(Stream output, object value)
    {
        string json = new JavaScriptSerializer().Serialize(value);
        byte[] payload = Encoding.UTF8.GetBytes(json);
        byte[] length = BitConverter.GetBytes(payload.Length);
        output.Write(length, 0, length.Length);
        output.Write(payload, 0, payload.Length);
        output.Flush();
    }
}
